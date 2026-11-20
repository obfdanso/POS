require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { app, prisma, request, createUserWithToken, deleteTestUsers, inTestBranch } = require('./helpers')

const PREFIX = 'promotest'
const TEST_SETTINGS = { tax_rate: '0', loyalty_points_rate: '10', require_open_shift: 'false' }
let manager, cashier, drinks, snacks, cola, juice, chips, originalSettings

const auth = (who) => who.headers
const createPromo = (body, who = manager) => request(app).post('/api/promotions').set(auth(who)).send(body)
const sell = (items) => request(app).post('/api/sales').set(auth(cashier)).send({ items, payment_method: 'CASH', amount_paid: 10000 })
const lineFor = (sale, product) => sale.items.find((i) => i.product_id === product.id)
const hourFromNow = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString()

beforeAll(async () => {
  originalSettings = await prisma.settings.findMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const [key, value] of Object.entries(TEST_SETTINGS)) {
    await prisma.settings.upsert({ where: { key }, update: { value }, create: { key, value } })
  }
  manager = await createUserWithToken('MANAGER', PREFIX)
  cashier = await createUserWithToken('CASHIER', PREFIX)
  drinks = await prisma.category.create({ data: { name: 'PromoTest Drinks' } })
  snacks = await prisma.category.create({ data: { name: 'PromoTest Snacks' } })
  const make = (name, sku, category, price) => prisma.product.create({ data: { name, sku, category_id: category.id, price, stocks: inTestBranch(500) } })
  cola = await make('PromoTest Cola', 'PROMOTEST-COLA', drinks, 10)
  juice = await make('PromoTest Juice', 'PROMOTEST-JUICE', drinks, 7.99)
  chips = await make('PromoTest Chips', 'PROMOTEST-CHIPS', snacks, 5)
})

afterAll(async () => {
  const userIds = (await prisma.user.findMany({ where: { username: { startsWith: PREFIX } }, select: { id: true } })).map((u) => u.id)
  const productIds = [cola.id, juice.id, chips.id]
  await prisma.auditLog.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.inventoryLog.deleteMany({ where: { product_id: { in: productIds } } })
  await prisma.sale.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.promotion.deleteMany({ where: { name: { startsWith: 'PromoTest' } } })
  await prisma.product.deleteMany({ where: { id: { in: productIds } } })
  await prisma.category.deleteMany({ where: { id: { in: [drinks.id, snacks.id] } } })
  await deleteTestUsers(PREFIX)
  await prisma.settings.deleteMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const { key, value } of originalSettings) await prisma.settings.create({ data: { key, value } })
  await prisma.$disconnect()
})

describe('Promotions', () => {
  let drinksPromo, colaPromo

  it('applies a category promotion automatically at checkout', async () => {
    const res = await createPromo({ name: 'PromoTest Drinks Week', percent_off: 10, category_id: drinks.id })
    expect(res.status).toBe(201)
    expect(res.body.data.status).toBe('ACTIVE')
    drinksPromo = res.body.data

    const sale = await sell([{ product_id: cola.id, quantity: 3 }, { product_id: chips.id, quantity: 2 }])
    expect(sale.status).toBe(201)
    const colaLine = lineFor(sale.body.data, cola)
    expect(colaLine).toMatchObject({ promotion_id: drinksPromo.id, promotion: { name: 'PromoTest Drinks Week' } })
    expect(parseFloat(colaLine.promotion_discount)).toBe(3) // 10% of 30
    expect(parseFloat(colaLine.total)).toBe(27)
    expect(lineFor(sale.body.data, chips).promotion_id).toBeNull()
    expect(parseFloat(sale.body.data.total_amount)).toBe(37) // 27 + 10
  })

  it('uses the biggest promotion that applies, and adds a cashier discount on top', async () => {
    colaPromo = (await createPromo({ name: 'PromoTest Cola Deal', percent_off: 25, product_id: cola.id })).body.data
    const sale = await sell([{ product_id: cola.id, quantity: 2, discount: 1 }, { product_id: juice.id, quantity: 1 }])
    expect(sale.status).toBe(201)
    const colaLine = lineFor(sale.body.data, cola)
    expect(colaLine.promotion_id).toBe(colaPromo.id)
    expect(parseFloat(colaLine.promotion_discount)).toBe(5) // 25% of 20 beats 10%
    expect(parseFloat(colaLine.discount)).toBe(6) // plus the cashier's 1
    expect(parseFloat(colaLine.total)).toBe(14)
    // 10% of 7.99 = 0.799, rounded to 0.80
    expect(parseFloat(lineFor(sale.body.data, juice).promotion_discount)).toBe(0.8)
  })

  it('rejects a cashier discount bigger than what is left after the promotion', async () => {
    const res = await sell([{ product_id: cola.id, quantity: 1, discount: 8 }]) // 10 − 2.50 = 7.50 left
    expect(res.status).toBe(422)
    expect(res.body.error.details[0].message).toMatch(/after the promotion \(7\.50\)/)
  })

  it('ignores promotions that are switched off, not started, or over', async () => {
    await request(app).put(`/api/promotions/${colaPromo.id}`).set(auth(manager)).send({ is_active: false })
    await request(app).put(`/api/promotions/${drinksPromo.id}`).set(auth(manager)).send({ starts_at: hourFromNow(1) })
    const scheduled = await request(app).get(`/api/promotions/${drinksPromo.id}`).set(auth(manager))
    expect(scheduled.body.data.status).toBe('SCHEDULED')

    const sale = await sell([{ product_id: cola.id, quantity: 1 }])
    expect(lineFor(sale.body.data, cola).promotion_id).toBeNull()
    expect(parseFloat(sale.body.data.total_amount)).toBe(10)
  })

  it('applies a storewide promotion to everything', async () => {
    const store = await createPromo({ name: 'PromoTest Storewide', percent_off: 5, starts_at: hourFromNow(-1), ends_at: hourFromNow(1) })
    expect(store.status).toBe(201)
    const sale = await sell([{ product_id: chips.id, quantity: 2 }])
    expect(parseFloat(lineFor(sale.body.data, chips).promotion_discount)).toBe(0.5)
    await request(app).put(`/api/promotions/${store.body.data.id}`).set(auth(manager)).send({ is_active: false })
  })

  it('lists running promotions for every till, and all promotions for managers', async () => {
    await request(app).put(`/api/promotions/${colaPromo.id}`).set(auth(manager)).send({ is_active: true })
    const active = await request(app).get('/api/promotions/active').set(auth(cashier))
    expect(active.status).toBe(200)
    const mine = active.body.data.filter((p) => p.name.startsWith('PromoTest'))
    expect(mine.map((p) => p.name)).toEqual(['PromoTest Cola Deal'])
    expect(mine[0].percent_off).toBe(25)

    const all = await request(app).get('/api/promotions').set(auth(manager))
    const cola25 = all.body.data.find((p) => p.id === colaPromo.id)
    expect(cola25).toMatchObject({ status: 'ACTIVE', times_used: 1, product: { name: 'PromoTest Cola' } })
    expect((await request(app).get('/api/promotions').set(auth(cashier))).status).toBe(403)
    expect((await createPromo({ name: 'PromoTest X', percent_off: 5 }, cashier)).status).toBe(403)
  })

  it('validates promotions', async () => {
    expect((await createPromo({ name: 'PromoTest Bad', percent_off: 0 })).status).toBe(422)
    expect((await createPromo({ name: 'PromoTest Bad', percent_off: 101 })).status).toBe(422)
    expect((await createPromo({ name: '', percent_off: 5 })).status).toBe(422)
    expect((await createPromo({ name: 'PromoTest Bad', percent_off: 5, product_id: cola.id, category_id: drinks.id })).status).toBe(422)
    expect((await createPromo({ name: 'PromoTest Bad', percent_off: 5, starts_at: hourFromNow(2), ends_at: hourFromNow(1) })).status).toBe(422)
    expect((await createPromo({ name: 'PromoTest Bad', percent_off: 5, product_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(422)
    expect((await createPromo({ name: 'PromoTest Bad', percent_off: 5, buy_x_get_y: true })).status).toBe(422)
  })

  it('keeps refunds right for promoted lines', async () => {
    const sale = (await sell([{ product_id: cola.id, quantity: 4 }])).body.data // 40 − 25% = 30
    expect(parseFloat(sale.total_amount)).toBe(30)
    const res = await request(app)
      .post(`/api/sales/${sale.id}/refund`)
      .set(auth(manager))
      .send({ items: [{ sale_item_id: lineFor(sale, cola).id, quantity: 1 }] })
    expect(res.status).toBe(200)
    expect(parseFloat(res.body.data.refunded_amount)).toBe(7.5) // what that can actually cost
  })
})
