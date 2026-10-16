require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const request = require('supertest')
const app = require('../app')
const prisma = require('../utils/prismaClient')
const bcrypt = require('bcrypt')
const { verifyPaystackPayment } = require('../utils/paystack')

// Never call the real Paystack API from tests
jest.mock('../utils/paystack', () => ({ verifyPaystackPayment: jest.fn() }))

function mockPaystackSuccess(amountGhs) {
  verifyPaystackPayment.mockResolvedValueOnce({
    status: true,
    data: { status: 'success', amount: Math.round(amountGhs * 100), channel: 'test' },
  })
}

// Tests assume 0% tax and 1 loyalty point per GHS 10; the dev database may be configured differently
const TEST_SETTINGS = { tax_rate: '0', loyalty_points_rate: '10' }
let originalSettings = []

let cashierToken
let managerToken
let testCategory
let testProduct
let testProduct2
let testCustomer
let cashierUser
let managerUser

beforeAll(async () => {
  originalSettings = await prisma.settings.findMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const [key, value] of Object.entries(TEST_SETTINGS)) {
    await prisma.settings.upsert({ where: { key }, update: { value }, create: { key, value } })
  }

  // Create test users
  const hash = await bcrypt.hash('testpass123', 12)
  cashierUser = await prisma.user.create({
    data: {
      username: 'sales_test_cashier',
      email: 'sales_test_cashier@test.com',
      password_hash: hash,
      full_name: 'Sales Test Cashier',
      role: 'CASHIER',
    },
  })
  managerUser = await prisma.user.create({
    data: {
      username: 'sales_test_manager',
      email: 'sales_test_manager@test.com',
      password_hash: hash,
      full_name: 'Sales Test Manager',
      role: 'MANAGER',
    },
  })

  // Login to get tokens
  const cashierLogin = await request(app)
    .post('/api/auth/login')
    .send({ username: 'sales_test_cashier', password: 'testpass123' })
  cashierToken = cashierLogin.body.data.accessToken

  const managerLogin = await request(app)
    .post('/api/auth/login')
    .send({ username: 'sales_test_manager', password: 'testpass123' })
  managerToken = managerLogin.body.data.accessToken

  // Create test category and products
  testCategory = await prisma.category.create({
    data: { name: 'SalesTest_Category_XYZ' },
  })
  testProduct = await prisma.product.create({
    data: {
      name: 'Sales Test Product A',
      sku: 'SALES-TEST-A',
      barcode: '1234560001111',
      category_id: testCategory.id,
      price: 10.0,
      cost_price: 5.0,
      quantity: 100,
      low_stock_threshold: 10,
    },
  })
  testProduct2 = await prisma.product.create({
    data: {
      name: 'Sales Test Product B',
      sku: 'SALES-TEST-B',
      barcode: '1234560002222',
      category_id: testCategory.id,
      price: 25.0,
      cost_price: 12.0,
      quantity: 5,
      low_stock_threshold: 5,
    },
  })
  testCustomer = await prisma.customer.create({
    data: {
      name: 'Sales Test Customer',
      phone: '0209990001',
      email: 'salescustomer@test.com',
      loyalty_points: 0,
    },
  })
})

afterAll(async () => {
  // Clean up in dependency order
  await prisma.inventoryLog.deleteMany({ where: { user_id: { in: [cashierUser.id, managerUser.id] } } })
  await prisma.payment.deleteMany({
    where: { sale: { user_id: { in: [cashierUser.id, managerUser.id] } } },
  })
  await prisma.saleItem.deleteMany({
    where: { sale: { user_id: { in: [cashierUser.id, managerUser.id] } } },
  })
  await prisma.sale.deleteMany({ where: { user_id: { in: [cashierUser.id, managerUser.id] } } })
  await prisma.customer.delete({ where: { id: testCustomer.id } })
  await prisma.product.deleteMany({ where: { category_id: testCategory.id } })
  await prisma.category.delete({ where: { id: testCategory.id } })
  await prisma.authLog.deleteMany({ where: { user_id: { in: [cashierUser.id, managerUser.id] } } })
  await prisma.user.deleteMany({ where: { id: { in: [cashierUser.id, managerUser.id] } } })
  await prisma.settings.deleteMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const { key, value } of originalSettings) {
    await prisma.settings.create({ data: { key, value } })
  }
  await prisma.$disconnect()
})

describe('POST /api/sales — create sale', () => {
  it('creates a CASH sale successfully and deducts stock', async () => {
    const initialProduct = await prisma.product.findUnique({ where: { id: testProduct.id } })
    const initialQty = initialProduct.quantity

    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        items: [{ product_id: testProduct.id, quantity: 2, discount: 0 }],
        payment_method: 'CASH',
        amount_paid: 30.0,
        discount_amount: 0,
      })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)

    const sale = res.body.data
    expect(sale.transaction_id).toMatch(/^TXN-\d{8}-\d{4}$/)
    expect(sale.payment_method).toBe('CASH')
    expect(sale.payment_status).toBe('COMPLETED')
    expect(parseFloat(sale.total_amount)).toBe(20.0)
    expect(sale.items).toHaveLength(1)
    expect(parseFloat(sale.items[0].unit_price)).toBe(10)
    expect(parseFloat(sale.payment.change_given)).toBe(10)

    // Verify stock was deducted
    const updatedProduct = await prisma.product.findUnique({ where: { id: testProduct.id } })
    expect(updatedProduct.quantity).toBe(initialQty - 2)

    // Verify inventory log was created
    const log = await prisma.inventoryLog.findFirst({
      where: { product_id: testProduct.id, change_type: 'SALE' },
      orderBy: { created_at: 'desc' },
    })
    expect(log).not.toBeNull()
    expect(log.quantity_change).toBe(-2)
  })

  it('creates a MOBILE_MONEY sale with reference', async () => {
    mockPaystackSuccess(10.0)
    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        items: [{ product_id: testProduct.id, quantity: 1 }],
        payment_method: 'MOBILE_MONEY',
        amount_paid: 10.0,
        reference: 'MOMO-REF-12345',
      })

    expect(res.status).toBe(201)
    expect(res.body.data.payment_method).toBe('MOBILE_MONEY')
    expect(res.body.data.payment.reference).toBe('MOMO-REF-12345')
    expect(verifyPaystackPayment).toHaveBeenCalledWith('MOMO-REF-12345')
  })

  it('awards loyalty points when customer is linked', async () => {
    const beforeCustomer = await prisma.customer.findUnique({ where: { id: testCustomer.id } })
    const beforePoints = beforeCustomer.loyalty_points

    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        items: [{ product_id: testProduct.id, quantity: 3 }],
        customer_id: testCustomer.id,
        payment_method: 'CASH',
        amount_paid: 30.0,
      })

    expect(res.status).toBe(201)

    // 3 * 10 = 30 GHS → 3 points at default rate of 10 GHS/point
    const afterCustomer = await prisma.customer.findUnique({ where: { id: testCustomer.id } })
    expect(afterCustomer.loyalty_points).toBeGreaterThan(beforePoints)
  })

  it('rejects sale when cash amount_paid is less than total', async () => {
    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        items: [{ product_id: testProduct.id, quantity: 2 }],
        payment_method: 'CASH',
        amount_paid: 5.0, // total is 20
      })

    expect(res.status).toBe(422)
    expect(res.body.success).toBe(false)
  })

  it('rejects sale when product has insufficient stock', async () => {
    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        items: [{ product_id: testProduct2.id, quantity: 999 }],
        payment_method: 'CASH',
        amount_paid: 99999.0,
      })

    expect(res.status).toBe(422)
    expect(res.body.error.message).toMatch(/insufficient stock/i)
  })

  it('rejects sale with non-existent product_id', async () => {
    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        items: [{ product_id: '00000000-0000-0000-0000-000000000000', quantity: 1 }],
        payment_method: 'CASH',
        amount_paid: 100.0,
      })

    expect(res.status).toBe(404)
  })

  it('returns 422 when items array is empty', async () => {
    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        items: [],
        payment_method: 'CASH',
        amount_paid: 10.0,
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).post('/api/sales').send({
      items: [{ product_id: testProduct.id, quantity: 1 }],
      payment_method: 'CASH',
      amount_paid: 10.0,
    })

    expect(res.status).toBe(401)
  })
})

describe('GET /api/sales — list sales', () => {
  it('returns paginated sales list', async () => {
    const res = await request(app)
      .get('/api/sales')
      .set('Authorization', `Bearer ${cashierToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.meta).toHaveProperty('page')
    expect(res.body.meta).toHaveProperty('total')
  })

  it('filters by date range', async () => {
    const today = new Date().toISOString().split('T')[0]
    const res = await request(app)
      .get(`/api/sales?start_date=${today}&end_date=${today}`)
      .set('Authorization', `Bearer ${cashierToken}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    // All returned sales should be from today
    res.body.data.forEach((s) => {
      const saleDate = new Date(s.created_at).toISOString().split('T')[0]
      expect(saleDate).toBe(today)
    })
  })
})

describe('GET /api/sales/:id', () => {
  let saleId

  beforeAll(async () => {
    mockPaystackSuccess(10.0)
    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        items: [{ product_id: testProduct.id, quantity: 1 }],
        payment_method: 'CARD',
        amount_paid: 10.0,
        reference: 'CARD-TEST-001',
      })
    saleId = res.body.data.id
  })

  it('returns full sale details with items and payment', async () => {
    const res = await request(app)
      .get(`/api/sales/${saleId}`)
      .set('Authorization', `Bearer ${cashierToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(saleId)
    expect(res.body.data.items).toHaveLength(1)
    expect(res.body.data.payment.reference).toBe('CARD-TEST-001')
    expect(res.body.data.user).toBeDefined()
  })

  it('returns 404 for non-existent sale', async () => {
    const res = await request(app)
      .get('/api/sales/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${cashierToken}`)

    expect(res.status).toBe(404)
  })
})

describe('GET /api/sales/:id/receipt', () => {
  let saleId

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        items: [{ product_id: testProduct.id, quantity: 1 }],
        payment_method: 'CASH',
        amount_paid: 15.0,
      })
    saleId = res.body.data.id
  })

  it('returns receipt data with store info', async () => {
    const res = await request(app)
      .get(`/api/sales/${saleId}/receipt`)
      .set('Authorization', `Bearer ${cashierToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.store).toBeDefined()
    expect(res.body.data.sale).toBeDefined()
    expect(res.body.data.sale.transaction_id).toMatch(/^TXN-/)
  })
})

describe('POST /api/sales/:id/refund', () => {
  let saleId
  let productQtyBeforeRefund

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        items: [{ product_id: testProduct.id, quantity: 2 }],
        payment_method: 'CASH',
        amount_paid: 25.0,
      })
    saleId = res.body.data.id
    const p = await prisma.product.findUnique({ where: { id: testProduct.id } })
    productQtyBeforeRefund = p.quantity
  })

  it('refunds a sale and restores stock (ADMIN/MANAGER only)', async () => {
    const res = await request(app)
      .post(`/api/sales/${saleId}/refund`)
      .set('Authorization', `Bearer ${managerToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.payment_status).toBe('REFUNDED')

    // Verify stock was restored
    const updatedProduct = await prisma.product.findUnique({ where: { id: testProduct.id } })
    expect(updatedProduct.quantity).toBe(productQtyBeforeRefund + 2)

    // Verify RETURN inventory log was created
    const log = await prisma.inventoryLog.findFirst({
      where: { product_id: testProduct.id, change_type: 'RETURN' },
      orderBy: { created_at: 'desc' },
    })
    expect(log).not.toBeNull()
    expect(log.quantity_change).toBe(2)
  })

  it('rejects double refund', async () => {
    const res = await request(app)
      .post(`/api/sales/${saleId}/refund`)
      .set('Authorization', `Bearer ${managerToken}`)

    expect(res.status).toBe(422)
    expect(res.body.error.message).toMatch(/already refunded/i)
  })

  it('returns 403 when cashier tries to refund', async () => {
    // Create a new sale to try to refund
    const saleRes = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        items: [{ product_id: testProduct.id, quantity: 1 }],
        payment_method: 'CASH',
        amount_paid: 10.0,
      })

    const newSaleId = saleRes.body.data.id

    const res = await request(app)
      .post(`/api/sales/${newSaleId}/refund`)
      .set('Authorization', `Bearer ${cashierToken}`)

    expect(res.status).toBe(403)
  })
})

describe('Sale safeguards', () => {
  let limitedProduct

  beforeAll(async () => {
    limitedProduct = await prisma.product.create({
      data: {
        name: 'Sales Test Limited Stock',
        sku: 'SALES-TEST-LIMITED',
        category_id: testCategory.id,
        price: 4.0,
        quantity: 3,
      },
    })
  })

  const cashSale = (productId, quantity = 1, extra = {}) =>
    request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ items: [{ product_id: productId, quantity }], payment_method: 'CASH', amount_paid: 100, ...extra })

  it('rejects a cart discount larger than the subtotal', async () => {
    const res = await cashSale(testProduct.id, 1, { discount_amount: 50 })
    expect(res.status).toBe(422)
    expect(res.body.error.details[0].field).toBe('discount_amount')
  })

  it('rejects an item discount larger than its line total', async () => {
    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ items: [{ product_id: testProduct.id, quantity: 1, discount: 11 }], payment_method: 'CASH', amount_paid: 100 })
    expect(res.status).toBe(422)
  })

  it('never oversells when sales run concurrently', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => cashSale(limitedProduct.id)))
    const succeeded = results.filter((r) => r.status === 201).length
    expect(succeeded).toBe(3)

    const product = await prisma.product.findUnique({ where: { id: limitedProduct.id } })
    expect(product.quantity).toBe(0)
  })

  it('verifies Paystack payments against the full total including tax', async () => {
    await prisma.settings.update({ where: { key: 'tax_rate' }, data: { value: '3' } })
    try {
      // 1 × GHS 10.00 + 3% tax = GHS 10.30; a charge of only GHS 10.00 must be rejected
      mockPaystackSuccess(10.0)
      const underpaid = await request(app)
        .post('/api/sales')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ items: [{ product_id: testProduct.id, quantity: 1 }], payment_method: 'CARD', amount_paid: 10.3, reference: 'CARD-UNDERPAID' })
      expect(underpaid.status).toBe(422)

      mockPaystackSuccess(10.3)
      const paid = await request(app)
        .post('/api/sales')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ items: [{ product_id: testProduct.id, quantity: 1 }], payment_method: 'CARD', amount_paid: 10.3, reference: 'CARD-FULL' })
      expect(paid.status).toBe(201)
      expect(parseFloat(paid.body.data.total_amount)).toBe(10.3)
    } finally {
      await prisma.settings.update({ where: { key: 'tax_rate' }, data: { value: '0' } })
    }
  })

  it('restores stock only once when the same refund is submitted concurrently', async () => {
    const sale = await cashSale(testProduct.id, 2)
    const before = await prisma.product.findUnique({ where: { id: testProduct.id } })

    const results = await Promise.all(
      [1, 2, 3].map(() =>
        request(app).post(`/api/sales/${sale.body.data.id}/refund`).set('Authorization', `Bearer ${managerToken}`)
      )
    )
    expect(results.filter((r) => r.status === 200)).toHaveLength(1)

    const after = await prisma.product.findUnique({ where: { id: testProduct.id } })
    expect(after.quantity).toBe(before.quantity + 2)
  })
})

describe('PUT /api/products/:id — activation is admin-only', () => {
  it('forbids a manager from deactivating a product', async () => {
    const res = await request(app)
      .put(`/api/products/${testProduct.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ is_active: false })
    expect(res.status).toBe(403)
    const product = await prisma.product.findUnique({ where: { id: testProduct.id } })
    expect(product.is_active).toBe(true)
  })

  it('lets a manager edit other fields when is_active is unchanged', async () => {
    const res = await request(app)
      .put(`/api/products/${testProduct.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ is_active: true, low_stock_threshold: 12 })
    expect(res.status).toBe(200)
    expect(res.body.data.low_stock_threshold).toBe(12)
  })
})

describe('Request hardening', () => {
  it('rejects fields an endpoint does not accept', async () => {
    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Field Check', loyalty_points: 5000 })
    expect(res.status).toBe(422)
    expect(res.body.error.details).toEqual([{ field: 'loyalty_points', message: 'Unexpected field "loyalty_points"' }])
  })

  it('rejects unknown sort fields', async () => {
    const res = await request(app).get('/api/sales?sort=password').set('Authorization', `Bearer ${managerToken}`)
    expect(res.status).toBe(422)
  })

  it('sorts sales by total, highest first', async () => {
    const res = await request(app)
      .get('/api/sales?sort=total_amount&order=desc&per_page=50')
      .set('Authorization', `Bearer ${managerToken}`)
    expect(res.status).toBe(200)
    const totals = res.body.data.map((s) => parseFloat(s.total_amount))
    expect(totals).toEqual([...totals].sort((a, b) => b - a))
  })
})
