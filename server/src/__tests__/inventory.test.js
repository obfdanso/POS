require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { app, prisma, request, createUserWithToken, deleteTestUsers, testBranch, createTestProduct, stockAt } = require('./helpers')

const PREFIX = 'invtest'
let managerToken
let cashierToken
let testCategory
let testProduct
let branch, other, manager, cashier, otherManager

const stockKey = () => ({ branch_id_product_id: { branch_id: branch.id, product_id: testProduct.id } })
const stockRow = () => prisma.branchStock.findUnique({ where: stockKey() })
const setStock = (data) => prisma.branchStock.update({ where: stockKey(), data })

beforeAll(async () => {
  branch = await testBranch()
  other = await prisma.branch.upsert({ where: { code: 'IVB' }, update: { is_active: true }, create: { name: 'InvTest Branch', code: 'IVB' } })
  manager = await createUserWithToken('MANAGER', PREFIX)
  cashier = await createUserWithToken('CASHIER', PREFIX)
  otherManager = await createUserWithToken('MANAGER', `${PREFIX}o`, { branchId: other.id })
  managerToken = manager.token
  cashierToken = cashier.token

  testCategory = await prisma.category.create({
    data: { name: 'Inv_Test_Category_XYZ' },
  })
  testProduct = await createTestProduct(
    { name: 'Inventory Test Product', sku: 'INV-TEST-001', barcode: '9990000000001', category_id: testCategory.id, price: 15.0 },
    { quantity: 50, low_stock_threshold: 10 }
  )
  await prisma.branchStock.create({ data: { branch_id: other.id, product_id: testProduct.id, quantity: 50, low_stock_threshold: 10 } })
})

afterAll(async () => {
  await prisma.inventoryLog.deleteMany({ where: { product_id: testProduct.id } })
  await prisma.branchStock.deleteMany({ where: { product_id: testProduct.id } })
  await prisma.product.delete({ where: { id: testProduct.id } })
  await prisma.category.delete({ where: { id: testCategory.id } })
  await deleteTestUsers(PREFIX)
  await deleteTestUsers(`${PREFIX}o`)
  await prisma.$disconnect()
})

describe('GET /api/inventory', () => {
  it('returns paginated inventory list', async () => {
    const res = await request(app)
      .get('/api/inventory')
      .set('Authorization', `Bearer ${managerToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.meta).toHaveProperty('total')
  })

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/inventory')
    expect(res.status).toBe(401)
  })
})

describe('GET /api/inventory/low-stock', () => {
  it('returns products at or below low_stock_threshold', async () => {
    // Set product quantity to exactly low_stock_threshold to ensure it appears
    await setStock({ quantity: 5, low_stock_threshold: 10 })

    const res = await request(app)
      .get('/api/inventory/low-stock')
      .set('Authorization', `Bearer ${managerToken}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    const found = res.body.data.find((p) => p.id === testProduct.id)
    expect(found).toBeDefined()
    expect(found.quantity).toBeLessThanOrEqual(found.low_stock_threshold)

    // Restore quantity
    await setStock({ quantity: 50 })
  })
})

describe('POST /api/inventory/restock', () => {
  it('increases stock and creates RESTOCK inventory log', async () => {
    const before = await stockRow()

    const res = await request(app)
      .post('/api/inventory/restock')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ product_id: testProduct.id, quantity: 20, notes: 'Test restock' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const after = await stockRow()
    expect(after.quantity).toBe(before.quantity + 20)

    const log = await prisma.inventoryLog.findFirst({
      where: { product_id: testProduct.id, change_type: 'RESTOCK' },
      orderBy: { created_at: 'desc' },
    })
    expect(log).not.toBeNull()
    expect(log.quantity_change).toBe(20)
    expect(log.previous_quantity).toBe(before.quantity)
    expect(log.new_quantity).toBe(before.quantity + 20)
  })

  it('returns 422 for restock quantity <= 0', async () => {
    const res = await request(app)
      .post('/api/inventory/restock')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ product_id: testProduct.id, quantity: 0 })

    expect(res.status).toBe(422)
  })

  it('returns 403 when cashier tries to restock', async () => {
    const res = await request(app)
      .post('/api/inventory/restock')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ product_id: testProduct.id, quantity: 10 })

    expect(res.status).toBe(403)
  })

  it('returns 404 for non-existent product', async () => {
    const res = await request(app)
      .post('/api/inventory/restock')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ product_id: '00000000-0000-0000-0000-000000000000', quantity: 10 })

    expect(res.status).toBe(404)
  })
})

describe('POST /api/inventory/adjust', () => {
  it('adjusts stock up and creates ADJUSTMENT log', async () => {
    const before = await stockRow()

    const res = await request(app)
      .post('/api/inventory/adjust')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ product_id: testProduct.id, quantity_change: 5, notes: 'Manual up' })

    expect(res.status).toBe(200)

    const after = await stockRow()
    expect(after.quantity).toBe(before.quantity + 5)
  })

  it('adjusts stock down with negative quantity_change', async () => {
    const before = await stockRow()

    const res = await request(app)
      .post('/api/inventory/adjust')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ product_id: testProduct.id, quantity_change: -5, notes: 'Manual down' })

    expect(res.status).toBe(200)

    const after = await stockRow()
    expect(after.quantity).toBe(before.quantity - 5)
  })

  it('rejects adjustment that would result in negative stock', async () => {
    const before = await stockRow()

    const res = await request(app)
      .post('/api/inventory/adjust')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ product_id: testProduct.id, quantity_change: -(before.quantity + 1) })

    expect(res.status).toBe(422)
    expect(res.body.error.message).toMatch(/negative stock/i)
  })

  it('returns 422 when quantity_change is 0', async () => {
    const res = await request(app)
      .post('/api/inventory/adjust')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ product_id: testProduct.id, quantity_change: 0 })

    expect(res.status).toBe(422)
  })

  it('returns 403 when cashier tries to adjust', async () => {
    const res = await request(app)
      .post('/api/inventory/adjust')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ product_id: testProduct.id, quantity_change: 1 })

    expect(res.status).toBe(403)
  })
})

describe('GET /api/inventory/log/:productId', () => {
  it('returns paginated inventory log for a product', async () => {
    // Ensure there is at least one log entry
    await request(app)
      .post('/api/inventory/restock')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ product_id: testProduct.id, quantity: 1, notes: 'Log test restock' })

    const res = await request(app)
      .get(`/api/inventory/log/${testProduct.id}`)
      .set('Authorization', `Bearer ${managerToken}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data.length).toBeGreaterThan(0)
    expect(res.body.data[0]).toHaveProperty('change_type')
    expect(res.body.data[0]).toHaveProperty('quantity_change')
  })

  it('returns 404 for non-existent product', async () => {
    const res = await request(app)
      .get('/api/inventory/log/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${managerToken}`)

    expect(res.status).toBe(404)
  })
})

describe('Concurrent stock adjustments', () => {
  it('applies every change exactly once and never goes below zero', async () => {
    await setStock({ quantity: 3 })

    const adjust = (quantity_change) =>
      request(app)
        .post('/api/inventory/adjust')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ product_id: testProduct.id, quantity_change })

    const results = await Promise.all([adjust(-1), adjust(-1), adjust(-1), adjust(-1), adjust(-1)])
    expect(results.filter((r) => r.status === 200)).toHaveLength(3)

    const product = await stockRow()
    expect(product.quantity).toBe(0)
  })
})

describe('Stock per branch', () => {
  it('restocking one branch leaves the other alone', async () => {
    const before = await stockAt(testProduct.id, other.id)
    const res = await request(app).post('/api/inventory/restock').set(manager.headers).send({ product_id: testProduct.id, quantity: 4 })
    expect(res.status).toBe(200)
    expect(await stockAt(testProduct.id, other.id)).toBe(before)
    const log = await prisma.inventoryLog.findUnique({ where: { id: res.body.data.log.id } })
    expect(log.branch_id).toBe(branch.id)
  })

  it('low stock is worked out per branch', async () => {
    await setStock({ quantity: 2, low_stock_threshold: 5 })
    try {
      const mine = await request(app).get('/api/inventory/low-stock').set(manager.headers)
      expect(mine.body.data.map((p) => p.id)).toContain(testProduct.id)
      const theirs = await request(app).get('/api/inventory/low-stock').set(otherManager.headers)
      expect(theirs.body.data.map((p) => p.id)).not.toContain(testProduct.id)
    } finally {
      await setStock({ quantity: 50, low_stock_threshold: 10 })
    }
  })

  it("lists only the branch's own stock rows, sortable by quantity", async () => {
    const res = await request(app).get('/api/inventory?search=INV-TEST&sort=quantity&order=desc').set(manager.headers)
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0]).toMatchObject({ id: testProduct.id, branch_id: branch.id, branch: { code: 'TEST' } })
  })

  it("shows a product's history for the branch only", async () => {
    const res = await request(app).get(`/api/inventory/log/${testProduct.id}`).set(otherManager.headers)
    expect(res.status).toBe(200)
    expect(res.body.data.every((l) => l.branch_id === other.id)).toBe(true)
  })
})
