require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { app, prisma, request, createUserWithToken, deleteTestUsers, inTestBranch, stockAt } = require('./helpers')

const PREFIX = 'returntest'
const TEST_SETTINGS = { tax_rate: '0', loyalty_points_rate: '10', require_open_shift: 'false' }
let manager, cashier, category, pen, book, cheap, customer, originalSettings

const auth = (who) => who.headers
const sell = (body) => request(app).post('/api/sales').set(auth(cashier)).send(body)
const refund = (saleId, body, who = manager) => request(app).post(`/api/sales/${saleId}/refund`).set(auth(who)).send(body)
const lineFor = (sale, product) => sale.items.find((i) => i.product_id === product.id)
const stockOf = async (product) => (await stockAt(product.id))

beforeAll(async () => {
  originalSettings = await prisma.settings.findMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const [key, value] of Object.entries(TEST_SETTINGS)) {
    await prisma.settings.upsert({ where: { key }, update: { value }, create: { key, value } })
  }
  manager = await createUserWithToken('MANAGER', PREFIX)
  cashier = await createUserWithToken('CASHIER', PREFIX)
  category = await prisma.category.create({ data: { name: 'ReturnTest Category' } })
  const products = await Promise.all([
    prisma.product.create({ data: { name: 'ReturnTest Pen', sku: 'RETURNTEST-PEN', category_id: category.id, price: 10, cost_price: 4, stocks: inTestBranch(100) } }),
    prisma.product.create({ data: { name: 'ReturnTest Book', sku: 'RETURNTEST-BOOK', category_id: category.id, price: 20, cost_price: 12, stocks: inTestBranch(100) } }),
    prisma.product.create({ data: { name: 'ReturnTest Cheap', sku: 'RETURNTEST-CHEAP', category_id: category.id, price: 3.33, stocks: inTestBranch(100) } }),
  ])
  pen = products[0]
  book = products[1]
  cheap = products[2]
  customer = await prisma.customer.create({ data: { name: 'ReturnTest Customer', loyalty_points: 0 } })
})

afterAll(async () => {
  const userIds = (
    await prisma.user.findMany({ where: { username: { startsWith: PREFIX } }, select: { id: true } })
  ).map((u) => u.id)
  const productIds = [pen.id, book.id, cheap.id]
  await prisma.auditLog.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.inventoryLog.deleteMany({ where: { product_id: { in: productIds } } })
  await prisma.sale.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.shift.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.product.deleteMany({ where: { id: { in: productIds } } })
  await prisma.category.deleteMany({ where: { name: { startsWith: 'ReturnTest' } } })
  await prisma.customer.deleteMany({ where: { name: { startsWith: 'ReturnTest' } } })
  await deleteTestUsers(PREFIX)
  await prisma.settings.deleteMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const { key, value } of originalSettings) await prisma.settings.create({ data: { key, value } })
  await prisma.$disconnect()
})

describe('Partial returns', () => {
  let sale

  beforeAll(async () => {
    // 3 pens at 10 + 1 book at 20 = 50, less a 5 cart discount = 45 paid; 4 loyalty points
    const res = await sell({
      items: [{ product_id: pen.id, quantity: 3 }, { product_id: book.id, quantity: 1 }],
      discount_amount: 5,
      customer_id: customer.id,
      payment_method: 'CASH',
      amount_paid: 50,
    })
    expect(res.status).toBe(201)
    sale = res.body.data
    expect((await prisma.customer.findUnique({ where: { id: customer.id } })).loyalty_points).toBe(4)
  })

  it('refunds one unit at its share of what was paid and restocks it', async () => {
    const before = await stockOf(pen)
    const res = await refund(sale.id, { items: [{ sale_item_id: lineFor(sale, pen).id, quantity: 1 }], reason: 'Wrong colour' })
    expect(res.status).toBe(200)
    expect(res.body.data.payment_status).toBe('PARTIALLY_REFUNDED')
    expect(parseFloat(res.body.data.refunded_amount)).toBe(9) // 45 × 10/50
    expect(res.body.data.refunds).toHaveLength(1)
    expect(res.body.data.refunds[0]).toMatchObject({ reason: 'Wrong colour', method: 'CASH' })
    expect(lineFor(res.body.data, pen).refunded_quantity).toBe(1)
    expect(await stockOf(pen)).toBe(before + 1)
    expect(await prisma.inventoryLog.count({ where: { product_id: pen.id, change_type: 'RETURN' } })).toBe(1)
  })

  it('reverses loyalty points in proportion to the money refunded', async () => {
    // 36 of 45 kept: floor(4 × 36/45) = 3 points kept
    expect((await prisma.customer.findUnique({ where: { id: customer.id } })).loyalty_points).toBe(3)
  })

  it('does not restock damaged goods', async () => {
    const before = await stockOf(book)
    const res = await refund(sale.id, { items: [{ sale_item_id: lineFor(sale, book).id, quantity: 1, restock: false }], reason: 'Damaged' })
    expect(res.status).toBe(200)
    expect(parseFloat(res.body.data.refunded_amount)).toBe(27) // 9 + 45 × 20/50
    expect(await stockOf(book)).toBe(before)
    expect(await prisma.inventoryLog.count({ where: { product_id: book.id, change_type: 'RETURN' } })).toBe(0)
    expect(res.body.data.refunds[1].items[0].restocked).toBe(false)
  })

  it('rejects returning more than is left, an item from another sale, or the same line twice', async () => {
    const penLine = lineFor(sale, pen).id
    expect((await refund(sale.id, { items: [{ sale_item_id: penLine, quantity: 3 }] })).status).toBe(422)
    expect((await refund(sale.id, { items: [{ sale_item_id: '00000000-0000-4000-8000-000000000000', quantity: 1 }] })).status).toBe(422)
    expect((await refund(sale.id, { items: [{ sale_item_id: penLine, quantity: 1 }, { sale_item_id: penLine, quantity: 1 }] })).status).toBe(422)
  })

  it('only lets managers and admins process returns', async () => {
    const res = await refund(sale.id, { items: [{ sale_item_id: lineFor(sale, pen).id, quantity: 1 }] }, cashier)
    expect(res.status).toBe(403)
  })

  it('refunds exactly what is left on the final return and marks the sale refunded', async () => {
    const res = await refund(sale.id, { items: [{ sale_item_id: lineFor(sale, pen).id, quantity: 2 }], reason: 'Changed mind' })
    expect(res.status).toBe(200)
    expect(res.body.data.payment_status).toBe('REFUNDED')
    expect(parseFloat(res.body.data.refunded_amount)).toBe(45)
    expect((await prisma.customer.findUnique({ where: { id: customer.id } })).loyalty_points).toBe(0)

    const again = await refund(sale.id, {})
    expect(again.status).toBe(422)
  })
})

describe('Rounding across several returns', () => {
  it('never refunds more or less than the sale total', async () => {
    // 3 × 3.33 = 9.99, less 0.01 = 9.98 paid
    const res = await sell({ items: [{ product_id: cheap.id, quantity: 3 }], discount_amount: 0.01, payment_method: 'CASH', amount_paid: 10 })
    const sale = res.body.data
    const line = sale.items[0].id
    const amounts = []
    for (let i = 0; i < 3; i++) {
      const r = await refund(sale.id, { items: [{ sale_item_id: line, quantity: 1 }] })
      expect(r.status).toBe(200)
      amounts.push(parseFloat(r.body.data.refunds[i].amount))
    }
    expect(amounts).toEqual([3.33, 3.33, 3.32])
  })
})

describe('Returns and the cash drawer', () => {
  it('takes cash refunds out of the refunding manager\'s open shift', async () => {
    const shift = (await request(app).post('/api/shifts/open').set(auth(manager)).send({ opening_float: 100 })).body.data
    const sale = (await sell({ items: [{ product_id: pen.id, quantity: 2 }], payment_method: 'CASH', amount_paid: 20 })).body.data

    const res = await refund(sale.id, { items: [{ sale_item_id: sale.items[0].id, quantity: 1 }], reason: 'Faulty' })
    expect(res.body.data.refunds[0].shift_id).toBe(shift.id)

    const current = (await request(app).get('/api/shifts/current').set(auth(manager))).body.data
    expect(current.summary).toMatchObject({ cash_refunds: 10, expected_cash: 90 })
  })
})

describe('Returns in reports', () => {
  it('counts only what the customer kept', async () => {
    const sale = (await sell({
      items: [{ product_id: pen.id, quantity: 4 }, { product_id: book.id, quantity: 1 }],
      payment_method: 'CASH',
      amount_paid: 60,
    })).body.data
    // Move the sale to a quiet date so other data can't affect the totals
    await prisma.sale.update({ where: { id: sale.id }, data: { created_at: new Date(2003, 4, 5, 12) } })
    await refund(sale.id, { items: [{ sale_item_id: lineFor(sale, pen).id, quantity: 1 }] })

    const range = 'start_date=2003-05-05&end_date=2003-05-05'
    const get = (path) => request(app).get(`/api/reports/${path}?${range}`).set(auth(manager))

    const summary = (await get('sales-summary')).body.data
    expect(summary).toMatchObject({ total_revenue: 50, transaction_count: 1 })

    const top = (await get('top-products')).body.data
    expect(top.find((p) => p.id === pen.id)).toMatchObject({ value: 30, quantity: 3 })

    const profit = (await get('profit')).body.data
    expect(profit.find((p) => p.id === pen.id)).toMatchObject({ revenue: 30, cost: 12, profit: 18 })
  })
})

describe('Concurrent returns', () => {
  it('lets only one of two simultaneous returns of the last unit through', async () => {
    const sale = (await sell({ items: [{ product_id: pen.id, quantity: 1 }], payment_method: 'CASH', amount_paid: 10 })).body.data
    const body = { items: [{ sale_item_id: sale.items[0].id, quantity: 1 }] }
    const results = await Promise.all([refund(sale.id, body), refund(sale.id, body)])
    expect(results.map((r) => r.status).sort()).toEqual([200, 422])
    expect(await prisma.refund.count({ where: { sale_id: sale.id } })).toBe(1)
  })
})
