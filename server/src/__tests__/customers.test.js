require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { app, prisma, request, createUserWithToken, deleteTestUsers } = require('./helpers')

const PREFIX = 'custtest'
let manager, cashier, customer, category, product

beforeAll(async () => {
  ;[manager, cashier] = await Promise.all([createUserWithToken('MANAGER', PREFIX), createUserWithToken('CASHIER', PREFIX)])
  customer = await prisma.customer.create({
    data: { name: 'CustTest Ama', phone: '099-000-1001', email: 'custtest.ama@test.local', loyalty_points: 40 },
  })
  category = await prisma.category.create({ data: { name: 'CustTest Category' } })
  product = await prisma.product.create({ data: { name: 'CustTest Item', sku: 'CUSTTEST-1', category_id: category.id, price: 10, quantity: 50 } })

  // Two completed purchases and one refunded, inserted directly so totals are known
  const sales = [
    { total: 20, status: 'COMPLETED', at: new Date('2026-01-10T10:00:00Z') },
    { total: 35, status: 'COMPLETED', at: new Date('2026-02-11T10:00:00Z') },
    { total: 99, status: 'REFUNDED', at: new Date('2026-03-12T10:00:00Z') },
  ]
  for (const [i, s] of sales.entries()) {
    await prisma.sale.create({
      data: {
        transaction_id: `TXN-CUSTTEST-${i}`,
        user_id: cashier.user.id,
        customer_id: customer.id,
        subtotal: s.total,
        total_amount: s.total,
        payment_method: 'CASH',
        payment_status: s.status,
        created_at: s.at,
        sale_items: { create: { product_id: product.id, quantity: 1, unit_price: s.total, total: s.total } },
        payments: { create: { method: 'CASH', amount_paid: s.total } },
      },
    })
  }
})

afterAll(async () => {
  await prisma.sale.deleteMany({ where: { transaction_id: { startsWith: 'TXN-CUSTTEST' } } })
  await prisma.product.deleteMany({ where: { sku: { startsWith: 'CUSTTEST' } } })
  await prisma.category.deleteMany({ where: { name: 'CustTest Category' } })
  await prisma.customer.deleteMany({ where: { name: { startsWith: 'CustTest' } } })
  await deleteTestUsers(PREFIX)
  await prisma.$disconnect()
})

const auth = (who) => ({ Authorization: `Bearer ${who.token}` })

describe('GET /api/customers', () => {
  it('searches by name, phone, or email and includes lifetime spend (refunds excluded)', async () => {
    for (const term of ['CustTest Ama', '099-000-1001', 'custtest.ama']) {
      const res = await request(app).get(`/api/customers?search=${encodeURIComponent(term)}`).set(auth(cashier))
      expect(res.status).toBe(200)
      const row = res.body.data.find((c) => c.id === customer.id)
      expect(row.total_purchases).toBe(55)
    }
  })

  it('sorts by loyalty points', async () => {
    const res = await request(app).get('/api/customers?sort=loyalty_points&order=desc&per_page=50').set(auth(manager))
    const points = res.body.data.map((c) => c.loyalty_points)
    expect(points).toEqual([...points].sort((a, b) => b - a))
  })
})

describe('GET /api/customers/:id', () => {
  it('returns a purchase summary', async () => {
    const res = await request(app).get(`/api/customers/${customer.id}`).set(auth(cashier))
    expect(res.status).toBe(200)
    expect(res.body.data.purchase_summary).toEqual({
      total_spent: 55,
      purchase_count: 2,
      average_purchase: 27.5,
      last_purchase_at: '2026-02-11T10:00:00.000Z',
    })
  })

  it('returns 404 for an unknown customer', async () => {
    expect((await request(app).get('/api/customers/00000000-0000-0000-0000-000000000000').set(auth(cashier))).status).toBe(404)
  })
})

describe('GET /api/customers/:id/purchases', () => {
  it('lists purchases newest first with item counts and status', async () => {
    const res = await request(app).get(`/api/customers/${customer.id}/purchases`).set(auth(cashier))
    expect(res.status).toBe(200)
    expect(res.body.data.map((s) => s.payment_status)).toEqual(['REFUNDED', 'COMPLETED', 'COMPLETED'])
    expect(res.body.data[0].items_count).toBe(1)
    expect(res.body.meta.total).toBe(3)
  })

  it('returns 404 for an unknown customer', async () => {
    const res = await request(app).get('/api/customers/00000000-0000-0000-0000-000000000000/purchases').set(auth(cashier))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/customers', () => {
  it('lets cashiers register a customer; blank contact fields are stored as null', async () => {
    const res = await request(app).post('/api/customers').set(auth(cashier)).send({ name: '  CustTest Kofi  ', phone: '', email: '' })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ name: 'CustTest Kofi', phone: null, email: null, loyalty_points: 0 })
  })

  it('requires a name and a valid email', async () => {
    const res = await request(app).post('/api/customers').set(auth(cashier)).send({ email: 'not-an-email' })
    expect(res.status).toBe(422)
    expect(res.body.error.details.map((d) => d.field)).toEqual(expect.arrayContaining(['name', 'email']))
  })

  it('rejects duplicate phone and email with field details', async () => {
    const phone = await request(app).post('/api/customers').set(auth(cashier)).send({ name: 'CustTest Dup', phone: '099-000-1001' })
    expect(phone.status).toBe(409)
    expect(phone.body.error.details[0].field).toBe('phone')

    const email = await request(app).post('/api/customers').set(auth(cashier)).send({ name: 'CustTest Dup', email: 'custtest.ama@test.local' })
    expect(email.status).toBe(409)
    expect(email.body.error.details[0].field).toBe('email')
  })
})

describe('PUT /api/customers/:id', () => {
  it('updates details (manager)', async () => {
    const res = await request(app).put(`/api/customers/${customer.id}`).set(auth(manager)).send({ address: 'Adum, Kumasi' })
    expect(res.status).toBe(200)
    expect(res.body.data.address).toBe('Adum, Kumasi')
  })

  it('rejects a phone number owned by another customer', async () => {
    const other = await prisma.customer.create({ data: { name: 'CustTest Other', phone: '099-000-1002' } })
    const res = await request(app).put(`/api/customers/${other.id}`).set(auth(manager)).send({ phone: '099-000-1001' })
    expect(res.status).toBe(409)
  })

  it('cannot edit loyalty points directly', async () => {
    const res = await request(app).put(`/api/customers/${customer.id}`).set(auth(manager)).send({ loyalty_points: 9999 })
    expect(res.status).toBe(422)
  })

  it('is forbidden for cashiers', async () => {
    expect((await request(app).put(`/api/customers/${customer.id}`).set(auth(cashier)).send({ address: 'x' })).status).toBe(403)
  })

  it('returns 404 for an unknown customer', async () => {
    const res = await request(app).put('/api/customers/00000000-0000-0000-0000-000000000000').set(auth(manager)).send({ address: 'x' })
    expect(res.status).toBe(404)
  })
})
