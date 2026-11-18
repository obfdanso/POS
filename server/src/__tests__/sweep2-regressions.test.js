// Regression tests for issues found in the second codebase sweep
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { app, prisma, request, createUserWithToken, deleteTestUsers } = require('./helpers')
const { verifyPaystackPayment } = require('../utils/paystack')

jest.mock('../utils/paystack', () => ({ verifyPaystackPayment: jest.fn() }))

const PREFIX = 'sweep2test'
const TEST_SETTINGS = { tax_rate: '0', loyalty_points_rate: '10' }
let manager, cashier, category, product, originalSettings

const auth = (who) => ({ Authorization: `Bearer ${who.token}` })
const sell = (who, body) => request(app).post('/api/sales').set(auth(who)).send(body)
const setTaxRate = (value) => prisma.settings.update({ where: { key: 'tax_rate' }, data: { value } })

beforeAll(async () => {
  originalSettings = await prisma.settings.findMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const [key, value] of Object.entries(TEST_SETTINGS)) {
    await prisma.settings.upsert({ where: { key }, update: { value }, create: { key, value } })
  }
  ;[manager, cashier] = await Promise.all([createUserWithToken('MANAGER', PREFIX), createUserWithToken('CASHIER', PREFIX)])
  category = await prisma.category.create({ data: { name: 'Sweep2Test Category' } })
  product = await prisma.product.create({
    data: { name: 'Sweep2Test Item', sku: 'SWEEP2TEST-1', category_id: category.id, price: 10, cost_price: 6, quantity: 500 },
  })
})

afterAll(async () => {
  const userIds = (await prisma.user.findMany({ where: { username: { startsWith: PREFIX } }, select: { id: true } })).map((u) => u.id)
  const productIds = (await prisma.product.findMany({ where: { sku: { startsWith: 'SWEEP2TEST' } }, select: { id: true } })).map((p) => p.id)
  await prisma.auditLog.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.inventoryLog.deleteMany({ where: { product_id: { in: productIds } } })
  await prisma.sale.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.product.deleteMany({ where: { id: { in: productIds } } })
  await prisma.category.deleteMany({ where: { name: { startsWith: 'Sweep2Test' } } })
  await deleteTestUsers(PREFIX)
  await prisma.settings.deleteMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const { key, value } of originalSettings) await prisma.settings.create({ data: { key, value } })
  await prisma.$disconnect()
})

describe('Sales', () => {
  it('does not store a payment reference on a cash sale', async () => {
    const res = await sell(cashier, { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'CASH', amount_paid: 10, reference: 'SWEEP2-CASH-REF' })
    expect(res.status).toBe(201)
    expect(res.body.data.payment.reference).toBeNull()
  })

  it('records the verified total as the amount paid for card sales', async () => {
    verifyPaystackPayment.mockResolvedValueOnce({ status: true, data: { status: 'success', amount: 1000, currency: 'GHS' } })
    const res = await sell(cashier, { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'CARD', amount_paid: 0, reference: 'SWEEP2-CARD-REF' })
    expect(res.status).toBe(201)
    expect(parseFloat(res.body.data.payment.amount_paid)).toBe(10)
  })

  it('rounds half a pesewa of tax up', async () => {
    const cheap = await prisma.product.create({
      data: { name: 'Sweep2Test Cheap', sku: 'SWEEP2TEST-2', category_id: category.id, price: 8.04, quantity: 10 },
    })
    await setTaxRate('12.5')
    try {
      // 8.04 × 12.5% = 1.005, which floating point stores as 1.00499…
      const res = await sell(cashier, { items: [{ product_id: cheap.id, quantity: 1 }], payment_method: 'CASH', amount_paid: 20 })
      expect(res.status).toBe(201)
      expect(parseFloat(res.body.data.tax_amount)).toBe(1.01)
      expect(parseFloat(res.body.data.total_amount)).toBe(9.05)
    } finally {
      await setTaxRate('0')
    }
  })
})

describe('Reports', () => {
  it('counts the cost of fully discounted items in profit', async () => {
    await prisma.sale.create({
      data: {
        transaction_id: 'TXN-SWEEP2-0001',
        user_id: cashier.user.id,
        subtotal: 0,
        total_amount: 0,
        payment_method: 'CASH',
        payment_status: 'COMPLETED',
        created_at: new Date(2002, 3, 10, 12),
        sale_items: { create: [{ product_id: product.id, quantity: 1, unit_price: 10, unit_cost: 6, discount: 10, total: 0 }] },
      },
    })
    const res = await request(app).get('/api/reports/profit?start_date=2002-04-10&end_date=2002-04-10').set(auth(manager))
    expect(res.status).toBe(200)
    expect(res.body.data.find((p) => p.id === product.id)).toMatchObject({ revenue: 0, cost: 6, profit: -6 })
  })

  it('accepts an end date without a start date', async () => {
    const res = await request(app).get('/api/reports/sales-summary?end_date=2002-01-31').set(auth(manager))
    expect(res.status).toBe(200)
  })
})

describe('Products', () => {
  it('keeps a cost price of 0', async () => {
    const res = await request(app).post('/api/products').set(auth(manager))
      .send({ name: 'Sweep2Test Free', sku: 'SWEEP2TEST-FREE', category_id: category.id, price: 1, cost_price: 0 })
    expect(res.status).toBe(201)
    expect(parseFloat(res.body.data.cost_price)).toBe(0)
  })
})

describe('Validation', () => {
  it('rejects a repeated search parameter instead of failing with a 500', async () => {
    const res = await request(app).get('/api/products?search=a&search=b').set(auth(manager))
    expect(res.status).toBe(422)
  })

  it('rejects a non-text customer name instead of failing with a 500', async () => {
    const res = await request(app).post('/api/customers').set(auth(manager)).send({ name: ['Sweep2Test'] })
    expect(res.status).toBe(422)
  })

  it('returns 413 for an oversized request body', async () => {
    const res = await request(app).post('/api/customers').set(auth(manager))
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ name: 'x'.repeat(2 * 1024 * 1024) }))
    expect(res.status).toBe(413)
    expect(res.body.success).toBe(false)
  })
})

describe('Auth', () => {
  it('logs a login attempt on a deactivated account', async () => {
    await prisma.user.update({ where: { id: cashier.user.id }, data: { is_active: false } })
    try {
      const res = await request(app).post('/api/auth/login').send({ username: `${PREFIX}_cashier`, password: 'testpass123' })
      expect(res.status).toBe(401)
      const logged = await prisma.authLog.findFirst({ where: { user_id: cashier.user.id, event_type: 'LOGIN_BLOCKED' } })
      expect(logged).not.toBeNull()
    } finally {
      await prisma.user.update({ where: { id: cashier.user.id }, data: { is_active: true } })
    }
  })
})
