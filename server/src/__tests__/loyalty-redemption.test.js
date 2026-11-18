require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { app, prisma, request, createUserWithToken, deleteTestUsers } = require('./helpers')

const PREFIX = 'redeemtest'
const TEST_SETTINGS = { tax_rate: '0', loyalty_points_rate: '10', loyalty_point_value: '0.10', require_open_shift: 'false' }
let manager, cashier, category, pen, book, customer, originalSettings

const auth = (who) => ({ Authorization: `Bearer ${who.token}` })
const sell = (body) => request(app).post('/api/sales').set(auth(cashier)).send(body)
const refund = (saleId, body) => request(app).post(`/api/sales/${saleId}/refund`).set(auth(manager)).send(body)
const lineFor = (sale, product) => sale.items.find((i) => i.product_id === product.id)
const pointsOf = async (c) => (await prisma.customer.findUnique({ where: { id: c.id } })).loyalty_points
const setSetting = (key, value) => prisma.settings.upsert({ where: { key }, update: { value }, create: { key, value } })
const cart = () => [{ product_id: pen.id, quantity: 3 }, { product_id: book.id, quantity: 1 }] // 3 × 10 + 20 = 50

beforeAll(async () => {
  originalSettings = await prisma.settings.findMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const [key, value] of Object.entries(TEST_SETTINGS)) await setSetting(key, value)
  manager = await createUserWithToken('MANAGER', PREFIX)
  cashier = await createUserWithToken('CASHIER', PREFIX)
  category = await prisma.category.create({ data: { name: 'RedeemTest Category' } })
  pen = await prisma.product.create({ data: { name: 'RedeemTest Pen', sku: 'REDEEMTEST-PEN', category_id: category.id, price: 10, quantity: 200 } })
  book = await prisma.product.create({ data: { name: 'RedeemTest Book', sku: 'REDEEMTEST-BOOK', category_id: category.id, price: 20, quantity: 200 } })
  customer = await prisma.customer.create({ data: { name: 'RedeemTest Customer', loyalty_points: 500 } })
})

afterAll(async () => {
  const userIds = (await prisma.user.findMany({ where: { username: { startsWith: PREFIX } }, select: { id: true } })).map((u) => u.id)
  await prisma.auditLog.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.inventoryLog.deleteMany({ where: { product_id: { in: [pen.id, book.id] } } })
  await prisma.sale.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.product.deleteMany({ where: { id: { in: [pen.id, book.id] } } })
  await prisma.category.deleteMany({ where: { name: { startsWith: 'RedeemTest' } } })
  await prisma.customer.deleteMany({ where: { name: { startsWith: 'RedeemTest' } } })
  await deleteTestUsers(PREFIX)
  await prisma.settings.deleteMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const { key, value } of originalSettings) await prisma.settings.create({ data: { key, value } })
  await prisma.$disconnect()
})

describe('Redeeming loyalty points at checkout', () => {
  let sale

  it('takes the points value off the total and deducts the points', async () => {
    const res = await sell({ items: cart(), customer_id: customer.id, redeem_points: 100, payment_method: 'CASH', amount_paid: 40 })
    expect(res.status).toBe(201)
    sale = res.body.data
    expect(parseFloat(sale.total_amount)).toBe(40) // 50 − 100 × 0.10
    expect(parseFloat(sale.discount_amount)).toBe(10)
    expect(parseFloat(sale.points_discount)).toBe(10)
    expect(sale.loyalty_points_redeemed).toBe(100)
    expect(sale.loyalty_points_earned).toBe(4) // earned on the 40 actually paid
    expect(await pointsOf(customer)).toBe(404)
  })

  it('gives back redeemed points in proportion to the goods returned', async () => {
    const res = await refund(sale.id, { items: [{ sale_item_id: lineFor(sale, pen).id, quantity: 1 }] })
    expect(res.status).toBe(200)
    expect(parseFloat(res.body.data.refunded_amount)).toBe(8) // 40 × 10/50 in money
    expect(res.body.data.loyalty_points_restored).toBe(20) // 100 × 10/50 back as points
    // +20 restored, −1 earned point reversed (floor(4 × 32/40) = 3 kept)
    expect(await pointsOf(customer)).toBe(423)
  })

  it('gives back every redeemed point once the whole sale is returned', async () => {
    const res = await refund(sale.id, {})
    expect(res.status).toBe(200)
    expect(res.body.data.payment_status).toBe('REFUNDED')
    expect(res.body.data.loyalty_points_restored).toBe(100)
    expect(await pointsOf(customer)).toBe(500)
  })

  it('applies tax after the points discount', async () => {
    await setSetting('tax_rate', '10')
    try {
      const res = await sell({ items: cart(), customer_id: customer.id, redeem_points: 50, payment_method: 'CASH', amount_paid: 100 })
      expect(res.status).toBe(201)
      expect(parseFloat(res.body.data.tax_amount)).toBe(4.5) // (50 − 5) × 10%
      expect(parseFloat(res.body.data.total_amount)).toBe(49.5)
    } finally {
      await setSetting('tax_rate', '0')
    }
  })

  it('rejects redeeming without a customer, more than the balance, or more than the sale is worth', async () => {
    const before = await pointsOf(customer)
    const noCustomer = await sell({ items: cart(), redeem_points: 10, payment_method: 'CASH', amount_paid: 50 })
    expect(noCustomer.status).toBe(422)
    expect(noCustomer.body.error.details[0].field).toBe('redeem_points')

    const tooMany = await sell({ items: cart(), customer_id: customer.id, redeem_points: before + 1, payment_method: 'CASH', amount_paid: 50 })
    expect(tooMany.status).toBe(422)

    // 50 − 45 cart discount leaves 5, worth 50 points
    const overSubtotal = await sell({ items: cart(), customer_id: customer.id, discount_amount: 45, redeem_points: 51, payment_method: 'CASH', amount_paid: 50 })
    expect(overSubtotal.status).toBe(422)
    expect(overSubtotal.body.error.details[0].message).toMatch(/50 or fewer/)

    expect((await sell({ items: cart(), customer_id: customer.id, redeem_points: 1.5, payment_method: 'CASH', amount_paid: 50 })).status).toBe(422)
    expect(await pointsOf(customer)).toBe(before)
  })

  it('rejects redemption when it is turned off', async () => {
    await setSetting('loyalty_point_value', '0')
    try {
      const res = await sell({ items: cart(), customer_id: customer.id, redeem_points: 10, payment_method: 'CASH', amount_paid: 50 })
      expect(res.status).toBe(422)
      expect(res.body.error.details[0].message).toMatch(/turned off/)
    } finally {
      await setSetting('loyalty_point_value', '0.10')
    }
  })

  it('never lets two simultaneous sales spend the same points', async () => {
    const shopper = await prisma.customer.create({ data: { name: 'RedeemTest Shopper', loyalty_points: 300 } })
    const body = { items: [{ product_id: pen.id, quantity: 3 }], customer_id: shopper.id, redeem_points: 200, payment_method: 'CASH', amount_paid: 30 }
    const results = await Promise.all([sell(body), sell(body)])
    expect(results.map((r) => r.status).sort()).toEqual([201, 422])
    // 300 − 200 spent + floor(10 / 10) earned
    expect(await pointsOf(shopper)).toBe(101)
  })
})
