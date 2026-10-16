// Regression tests for issues found in the codebase sweep
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { app, prisma, request, createUserWithToken, deleteTestUsers } = require('./helpers')
const { verifyPaystackPayment } = require('../utils/paystack')

jest.mock('../utils/paystack', () => ({ verifyPaystackPayment: jest.fn() }))

const PREFIX = 'sweeptest'
const TEST_SETTINGS = { tax_rate: '0', loyalty_points_rate: '10' }
let admin, manager, cashier, otherCashier, category, product, customer, originalSettings

const auth = (who) => ({ Authorization: `Bearer ${who.token}` })
const paystackOk = (amountGhs, currency = 'GHS') =>
  verifyPaystackPayment.mockResolvedValueOnce({ status: true, data: { status: 'success', amount: Math.round(amountGhs * 100), currency } })
const sell = (who, body) => request(app).post('/api/sales').set(auth(who)).send(body)

beforeAll(async () => {
  originalSettings = await prisma.settings.findMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const [key, value] of Object.entries(TEST_SETTINGS)) {
    await prisma.settings.upsert({ where: { key }, update: { value }, create: { key, value } })
  }
  [admin, manager, cashier] = await Promise.all([
    createUserWithToken('ADMIN', PREFIX),
    createUserWithToken('MANAGER', PREFIX),
    createUserWithToken('CASHIER', PREFIX),
  ])
  otherCashier = await createUserWithToken('CASHIER', `${PREFIX}2`)
  category = await prisma.category.create({ data: { name: 'SweepTest Category' } })
  product = await prisma.product.create({
    data: { name: 'SweepTest Item', sku: 'SWEEPTEST-1', category_id: category.id, price: 10, cost_price: 6, quantity: 500 },
  })
  customer = await prisma.customer.create({ data: { name: 'SweepTest Customer', loyalty_points: 0 } })
})

afterAll(async () => {
  const userIds = (await prisma.user.findMany({ where: { username: { startsWith: PREFIX } }, select: { id: true } })).map((u) => u.id)
  await prisma.auditLog.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.inventoryLog.deleteMany({ where: { product_id: product.id } })
  await prisma.sale.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.product.deleteMany({ where: { sku: { startsWith: 'SWEEPTEST' } } })
  await prisma.category.deleteMany({ where: { name: { startsWith: 'SweepTest' } } })
  await prisma.customer.deleteMany({ where: { name: { startsWith: 'SweepTest' } } })
  await deleteTestUsers(PREFIX)
  await deleteTestUsers(`${PREFIX}2`)
  await prisma.settings.deleteMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const { key, value } of originalSettings) await prisma.settings.create({ data: { key, value } })
  await prisma.$disconnect()
})

describe('Sales', () => {
  it('rejects reusing a Paystack reference for a second sale', async () => {
    paystackOk(10)
    const first = await sell(cashier, { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'CARD', amount_paid: 10, reference: 'SWEEP-REF-1' })
    expect(first.status).toBe(201)

    const reused = await sell(cashier, { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'CARD', amount_paid: 10, reference: 'SWEEP-REF-1' })
    expect(reused.status).toBe(409)
    expect(reused.body.error.details[0].field).toBe('reference')
  })

  it('rejects a Paystack payment in another currency', async () => {
    paystackOk(10, 'NGN')
    const res = await sell(cashier, { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'CARD', amount_paid: 10, reference: 'SWEEP-REF-NGN' })
    expect(res.status).toBe(422)
  })

  it('checks the customer exists before verifying payment', async () => {
    verifyPaystackPayment.mockClear()
    const res = await sell(cashier, {
      items: [{ product_id: product.id, quantity: 1 }],
      customer_id: '00000000-0000-0000-0000-000000000000',
      payment_method: 'CARD',
      amount_paid: 10,
      reference: 'SWEEP-REF-NOCUST',
    })
    expect(res.status).toBe(422)
    expect(res.body.error.details[0].field).toBe('customer_id')
    expect(verifyPaystackPayment).not.toHaveBeenCalled()
  })

  it('accepts numeric strings and rejects out-of-range amounts with 422, not 500', async () => {
    const asStrings = await sell(cashier, { items: [{ product_id: product.id, quantity: '2' }], payment_method: 'CASH', amount_paid: '50' })
    expect(asStrings.status).toBe(201)
    expect(asStrings.body.data.items[0].quantity).toBe(2)

    const huge = await sell(cashier, { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'CASH', amount_paid: 100000000 })
    expect(huge.status).toBe(422)
  })

  it('records the cost price at the time of sale', async () => {
    const res = await sell(cashier, { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'CASH', amount_paid: 10 })
    const item = await prisma.saleItem.findFirst({ where: { sale_id: res.body.data.id } })
    expect(parseFloat(item.unit_cost)).toBe(6)
  })

  it('a refund reverses exactly the points the sale earned, even after the rate changes', async () => {
    const sale = await sell(cashier, { items: [{ product_id: product.id, quantity: 5 }], customer_id: customer.id, payment_method: 'CASH', amount_paid: 50 })
    expect(sale.body.data.loyalty_points_earned).toBe(5) // GHS 50 at 1 point per GHS 10
    await prisma.customer.update({ where: { id: customer.id }, data: { loyalty_points: { increment: 7 } } }) // points from elsewhere

    await prisma.settings.update({ where: { key: 'loyalty_points_rate' }, data: { value: '1' } })
    try {
      const refund = await request(app).post(`/api/sales/${sale.body.data.id}/refund`).set(auth(manager))
      expect(refund.status).toBe(200)
    } finally {
      await prisma.settings.update({ where: { key: 'loyalty_points_rate' }, data: { value: '10' } })
    }
    expect((await prisma.customer.findUnique({ where: { id: customer.id } })).loyalty_points).toBe(7)

    const audit = await prisma.auditLog.findFirst({ where: { action: 'SALE_REFUNDED', entity_id: sale.body.data.id } })
    expect(audit.user_id).toBe(manager.user.id)
  })

  it('cashiers only see their own sales in a customer purchase history', async () => {
    await sell(otherCashier, { items: [{ product_id: product.id, quantity: 1 }], customer_id: customer.id, payment_method: 'CASH', amount_paid: 10 })
    const asCashier = await request(app).get(`/api/customers/${customer.id}/purchases`).set(auth(cashier))
    expect(asCashier.body.data.every((s) => s.user_id === cashier.user.id)).toBe(true)
    const asManager = await request(app).get(`/api/customers/${customer.id}/purchases`).set(auth(manager))
    expect(asManager.body.data.some((s) => s.user_id === otherCashier.user.id)).toBe(true)
  })
})

describe('Reports', () => {
  it('product revenue is after the cart discount, matching the sales summary', async () => {
    await prisma.sale.create({
      data: {
        transaction_id: 'TXN-SWEEPTEST-DISC',
        user_id: cashier.user.id,
        subtotal: 100,
        discount_amount: 20,
        total_amount: 80,
        payment_method: 'CASH',
        created_at: new Date(2001, 5, 15, 12),
        sale_items: { create: { product_id: product.id, quantity: 10, unit_price: 10, unit_cost: 6, total: 100 } },
        payments: { create: { method: 'CASH', amount_paid: 80 } },
      },
    })
    const range = 'start_date=2001-06-15&end_date=2001-06-15'
    const get = (path) => request(app).get(`/api/reports/${path}?${range}`).set(auth(manager))

    expect((await get('sales-summary')).body.data.total_revenue).toBe(80)
    expect((await get('top-products')).body.data[0].value).toBe(80)
    expect((await get('category-performance')).body.data[0].value).toBe(80)
    expect((await get('profit')).body.data[0]).toMatchObject({ revenue: 80, cost: 60, profit: 20 })
  })
})

describe('Validation', () => {
  it('rejects whitespace-only names', async () => {
    expect((await request(app).post('/api/categories').set(auth(manager)).send({ name: '   ' })).status).toBe(422)
    const product = await request(app).post('/api/products').set(auth(manager)).send({ name: '  ', sku: '  ', category_id: category.id, price: 1 })
    expect(product.status).toBe(422)
    expect(product.body.error.details.map((d) => d.field)).toEqual(expect.arrayContaining(['name', 'sku']))
  })

  it('rejects an unknown supplier with 422', async () => {
    const res = await request(app).post('/api/products').set(auth(manager))
      .send({ name: 'SweepTest Sup', sku: 'SWEEPTEST-SUP', category_id: category.id, supplier_id: '00000000-0000-0000-0000-000000000000', price: 1 })
    expect(res.status).toBe(422)
    expect(res.body.error.details[0].field).toBe('supplier_id')
  })

  it('cannot slip a non-boolean is_active past the self-deactivation guard', async () => {
    for (const is_active of ['false', 0, 'no']) {
      const res = await request(app).put(`/api/users/${admin.user.id}`).set(auth(admin)).send({ is_active })
      expect(res.status).toBe(422)
    }
    expect((await prisma.user.findUnique({ where: { id: admin.user.id } })).is_active).toBe(true)
  })

  it('records who deactivated a product', async () => {
    const extra = await prisma.product.create({ data: { name: 'SweepTest Old', sku: 'SWEEPTEST-OLD', category_id: category.id, price: 1 } })
    await request(app).delete(`/api/products/${extra.id}`).set(auth(admin))
    const audit = await prisma.auditLog.findFirst({ where: { action: 'PRODUCT_DEACTIVATED', entity_id: extra.id } })
    expect(audit.user_id).toBe(admin.user.id)
  })
})

describe('Auth', () => {
  it('counts parallel wrong passwords, so the lock cannot be outrun', async () => {
    const victim = await createUserWithToken('CASHIER', `${PREFIX}3`)
    await Promise.all(
      Array.from({ length: 8 }, () => request(app).post('/api/auth/login').send({ username: `${PREFIX}3_cashier`, password: 'wrong' }))
    )
    const user = await prisma.user.findUnique({ where: { id: victim.user.id } })
    expect(user.failed_login_attempts).toBeGreaterThanOrEqual(5)
    expect(user.locked_until).not.toBeNull()
    await deleteTestUsers(`${PREFIX}3`)
  })

  it('changing the password signs out other sessions but keeps this one', async () => {
    const victim = await createUserWithToken('CASHIER', `${PREFIX}4`)
    const otherDevice = await request(app).post('/api/auth/login').send({ username: `${PREFIX}4_cashier`, password: 'testpass123' })
    const otherCookie = otherDevice.headers['set-cookie']
    const otherAccess = otherDevice.body.data.accessToken

    // Tokens carry one-second timestamps; make sure the change happens in a later second
    await new Promise((r) => setTimeout(r, 1100))
    const change = await request(app).post('/api/auth/change-password').set(auth(victim))
      .send({ current_password: 'testpass123', new_password: 'brandnew123' })
    expect(change.status).toBe(200)

    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${otherAccess}`)).status).toBe(401)
    expect((await request(app).post('/api/auth/refresh').set('Cookie', otherCookie)).status).toBe(401)
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${change.body.data.accessToken}`)).status).toBe(200)
    await deleteTestUsers(`${PREFIX}4`)
  })
})
