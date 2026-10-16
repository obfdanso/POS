require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { app, prisma, request, createUserWithToken, deleteTestUsers } = require('./helpers')

const PREFIX = 'reptest'
// A quiet date range in the past, so the report totals below come only from this file's data
const RANGE = 'start_date=2001-03-05&end_date=2001-03-07'
let manager, cashier, catA, catB, pen, book

async function createSale(n, { day, items, status = 'COMPLETED', user }) {
  const subtotal = items.reduce((sum, i) => sum + i.qty * i.price, 0)
  return prisma.sale.create({
    data: {
      transaction_id: `TXN-REPTEST-${n}`,
      user_id: user.id,
      subtotal,
      tax_amount: 0,
      total_amount: subtotal,
      payment_method: 'CASH',
      payment_status: status,
      created_at: day,
      sale_items: {
        create: items.map((i) => ({ product_id: i.product.id, quantity: i.qty, unit_price: i.price, total: i.qty * i.price })),
      },
      payments: { create: { method: 'CASH', amount_paid: subtotal } },
    },
  })
}

beforeAll(async () => {
  [manager, cashier] = await Promise.all([createUserWithToken('MANAGER', PREFIX), createUserWithToken('CASHIER', PREFIX)])
  catA = await prisma.category.create({ data: { name: 'RepTest Writing' } })
  catB = await prisma.category.create({ data: { name: 'RepTest Paper' } })
  pen = await prisma.product.create({ data: { name: 'RepTest Pen', sku: 'REPTEST-PEN', category_id: catA.id, price: 2, cost_price: 1, quantity: 100 } })
  book = await prisma.product.create({ data: { name: 'RepTest Book', sku: 'REPTEST-BOOK', category_id: catB.id, price: 10, cost_price: 6, quantity: 100 } })

  const mar5 = new Date(2001, 2, 5, 12)
  const mar7 = new Date(2001, 2, 7, 12)
  // Mar 5: 3 pens (6) + 1 book (10) = 16 by the cashier; 1 book (10) by the manager
  await createSale(1, { day: mar5, user: cashier.user, items: [{ product: pen, qty: 3, price: 2 }, { product: book, qty: 1, price: 10 }] })
  await createSale(2, { day: mar5, user: manager.user, items: [{ product: book, qty: 1, price: 10 }] })
  // Mar 7: 5 pens (10) by the cashier, plus a refunded sale that every report must ignore
  await createSale(3, { day: mar7, user: cashier.user, items: [{ product: pen, qty: 5, price: 2 }] })
  await createSale(4, { day: mar7, user: cashier.user, status: 'REFUNDED', items: [{ product: book, qty: 9, price: 10 }] })
})

afterAll(async () => {
  await prisma.sale.deleteMany({ where: { transaction_id: { startsWith: 'TXN-REPTEST' } } })
  await prisma.product.deleteMany({ where: { sku: { startsWith: 'REPTEST' } } })
  await prisma.category.deleteMany({ where: { name: { startsWith: 'RepTest' } } })
  await deleteTestUsers(PREFIX)
  await prisma.$disconnect()
})

const get = (path, who = manager) => request(app).get(`/api/reports/${path}`).set('Authorization', `Bearer ${who.token}`)

describe('Report endpoints (completed sales only, aggregated in SQL)', () => {
  it('sales-summary', async () => {
    const res = await get(`sales-summary?${RANGE}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ total_revenue: 36, transaction_count: 3, average_sale: 12, total_discount: 0, total_tax: 0 })
  })

  it('sales-by-day includes days without sales', async () => {
    const res = await get(`sales-by-day?${RANGE}`)
    expect(res.body.data).toEqual([
      { label: '2001-03-05', value: 26, transactions: 2 },
      { label: '2001-03-06', value: 0, transactions: 0 },
      { label: '2001-03-07', value: 10, transactions: 1 },
    ])
  })

  it('top-products by revenue and by quantity', async () => {
    const byRevenue = await get(`top-products?${RANGE}`)
    expect(byRevenue.body.data.map((p) => [p.label, p.value, p.quantity])).toEqual([
      ['RepTest Book', 20, 2],
      ['RepTest Pen', 16, 8],
    ])
    const byQuantity = await get(`top-products?${RANGE}&by=quantity&limit=1`)
    expect(byQuantity.body.data.map((p) => p.label)).toEqual(['RepTest Pen'])
  })

  it('category-performance', async () => {
    const res = await get(`category-performance?${RANGE}`)
    expect(res.body.data.map((c) => [c.label, c.value, c.quantity])).toEqual([
      ['RepTest Paper', 20, 2],
      ['RepTest Writing', 16, 8],
    ])
  })

  it('cashier-performance', async () => {
    const res = await get(`cashier-performance?${RANGE}`)
    expect(res.body.data.map((c) => [c.username, c.value, c.transactions])).toEqual([
      [`${PREFIX}_cashier`, 26, 2],
      [`${PREFIX}_manager`, 10, 1],
    ])
  })

  it('profit uses cost price', async () => {
    const res = await get(`profit?${RANGE}`)
    const byName = Object.fromEntries(res.body.data.map((p) => [p.name, p]))
    expect(byName['RepTest Pen']).toMatchObject({ revenue: 16, cost: 8, profit: 8, margin: 50 })
    expect(byName['RepTest Book']).toMatchObject({ revenue: 20, cost: 12, profit: 8, margin: 40 })
  })

  it('inventory-status and dashboard return their summaries', async () => {
    const inventory = await get('inventory-status')
    expect(inventory.body.data).toEqual(expect.objectContaining({
      total_products: expect.any(Number),
      low_stock_count: expect.any(Number),
      out_of_stock_count: expect.any(Number),
      low_stock: expect.any(Array),
      out_of_stock: expect.any(Array),
    }))
    const dashboard = await get('dashboard')
    expect(dashboard.body.data).toEqual(expect.objectContaining({
      today_revenue: expect.any(Number),
      today_transactions: expect.any(Number),
      low_stock_alerts: expect.any(Number),
      top_products: expect.any(Array),
    }))
  })
})

describe('Report access and validation', () => {
  it('is forbidden for cashiers, except their own stats', async () => {
    expect((await get(`sales-summary?${RANGE}`, cashier)).status).toBe(403)

    await createSale(5, { day: new Date(), user: cashier.user, items: [{ product: pen, qty: 2, price: 2 }] })
    const stats = await get('cashier-stats', cashier)
    expect(stats.status).toBe(200)
    expect(stats.body.data).toMatchObject({ sales_count: 1, total_revenue: 4, items_sold: 2, average_sale: 4 })
    expect(stats.body.data.recent_sales[0].transaction_id).toBe('TXN-REPTEST-5')
  })

  it('rejects invalid dates, reversed ranges, and bad limits', async () => {
    expect((await get('sales-summary?start_date=not-a-date')).status).toBe(422)
    expect((await get('sales-summary?start_date=2001-03-07&end_date=2001-03-05')).status).toBe(422)
    expect((await get('top-products?limit=0')).status).toBe(422)
    expect((await get('top-products?by=price')).status).toBe(422)
  })
})
