require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { app, prisma, request, createUserWithToken, deleteTestUsers } = require('./helpers')

const PREFIX = 'prodtest'
let admin, manager, cashier, category, product

beforeAll(async () => {
  [admin, manager, cashier] = await Promise.all([
    createUserWithToken('ADMIN', PREFIX),
    createUserWithToken('MANAGER', PREFIX),
    createUserWithToken('CASHIER', PREFIX),
  ])
  category = await prisma.category.create({ data: { name: 'ProdTest Category' } })
  product = await prisma.product.create({
    data: { name: 'ProdTest Alpha', sku: 'PRODTEST-A', barcode: '9990000000011', category_id: category.id, price: 10, quantity: 5 },
  })
})

afterAll(async () => {
  const products = await prisma.product.findMany({ where: { sku: { startsWith: 'PRODTEST' } }, select: { id: true } })
  await prisma.inventoryLog.deleteMany({ where: { product_id: { in: products.map((p) => p.id) } } })
  await prisma.product.deleteMany({ where: { sku: { startsWith: 'PRODTEST' } } })
  await prisma.category.deleteMany({ where: { name: { startsWith: 'ProdTest' } } })
  await deleteTestUsers(PREFIX)
  await prisma.$disconnect()
})

const auth = (who) => ({ Authorization: `Bearer ${who.token}` })

describe('GET /api/products', () => {
  it('searches name, SKU, and barcode', async () => {
    for (const term of ['ProdTest Alpha', 'PRODTEST-A', '9990000000011']) {
      const res = await request(app).get(`/api/products?search=${term}`).set(auth(cashier))
      expect(res.status).toBe(200)
      expect(res.body.data.map((p) => p.id)).toContain(product.id)
    }
  })

  it('filters by category and paginates', async () => {
    const res = await request(app).get(`/api/products?category_id=${category.id}&per_page=1`).set(auth(cashier))
    expect(res.body.data).toHaveLength(1)
    expect(res.body.meta).toMatchObject({ page: 1, per_page: 1 })
  })

  it('sorts by price descending', async () => {
    const res = await request(app).get('/api/products?sort=price&order=desc&per_page=10').set(auth(manager))
    const prices = res.body.data.map((p) => parseFloat(p.price))
    expect(prices).toEqual([...prices].sort((a, b) => b - a))
  })

  it('caps per_page at 100', async () => {
    const res = await request(app).get('/api/products?per_page=101').set(auth(manager))
    expect(res.status).toBe(422)
  })

  it('only shows inactive products to managers and admins', async () => {
    const inactive = await prisma.product.create({
      data: { name: 'ProdTest Hidden', sku: 'PRODTEST-HIDDEN', category_id: category.id, price: 1, is_active: false },
    })
    const asCashier = await request(app).get('/api/products?status=inactive&search=ProdTest').set(auth(cashier))
    expect(asCashier.body.data.map((p) => p.id)).not.toContain(inactive.id)
    const asManager = await request(app).get('/api/products?status=inactive&search=ProdTest').set(auth(manager))
    expect(asManager.body.data.map((p) => p.id)).toEqual([inactive.id])
  })
})

describe('GET /api/products/:id and /barcode/:code', () => {
  it('returns a product with its category', async () => {
    const res = await request(app).get(`/api/products/${product.id}`).set(auth(cashier))
    expect(res.status).toBe(200)
    expect(res.body.data.category.name).toBe('ProdTest Category')
  })

  it('returns 404 for an unknown id and 422 for a malformed one', async () => {
    expect((await request(app).get('/api/products/00000000-0000-0000-0000-000000000000').set(auth(cashier))).status).toBe(404)
    expect((await request(app).get('/api/products/not-a-uuid').set(auth(cashier))).status).toBe(422)
  })

  it('looks up active products by barcode', async () => {
    const res = await request(app).get('/api/products/barcode/9990000000011').set(auth(cashier))
    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(product.id)
    expect((await request(app).get('/api/products/barcode/0000000000000').set(auth(cashier))).status).toBe(404)
  })
})

describe('POST /api/products', () => {
  it('creates a product and logs its opening stock', async () => {
    const res = await request(app)
      .post('/api/products')
      .set(auth(manager))
      .send({ name: 'ProdTest Beta', sku: 'PRODTEST-B', category_id: category.id, price: 7.5, cost_price: 4, quantity: 12 })
    expect(res.status).toBe(201)
    expect(res.body.data.quantity).toBe(12)

    const logs = await prisma.inventoryLog.findMany({ where: { product_id: res.body.data.id } })
    expect(logs).toEqual([expect.objectContaining({ change_type: 'RESTOCK', quantity_change: 12, new_quantity: 12 })])
  })

  it('accepts multipart form values (as sent with an image upload)', async () => {
    const res = await request(app)
      .post('/api/products')
      .set(auth(manager))
      .field('name', 'ProdTest Multipart')
      .field('sku', 'PRODTEST-MP')
      .field('category_id', category.id)
      .field('price', '3.25')
      .field('quantity', '4')
    expect(res.status).toBe(201)
    expect(res.body.data.quantity).toBe(4)
  })

  it('rejects duplicate SKU and barcode with field details', async () => {
    const dupSku = await request(app).post('/api/products').set(auth(manager))
      .send({ name: 'Dup', sku: 'PRODTEST-A', category_id: category.id, price: 1 })
    expect(dupSku.status).toBe(409)
    expect(dupSku.body.error.details[0].field).toBe('sku')

    const dupBarcode = await request(app).post('/api/products').set(auth(manager))
      .send({ name: 'Dup', sku: 'PRODTEST-DUP', barcode: '9990000000011', category_id: category.id, price: 1 })
    expect(dupBarcode.status).toBe(409)
    expect(dupBarcode.body.error.details[0].field).toBe('barcode')
  })

  it('validates required fields and price', async () => {
    const res = await request(app).post('/api/products').set(auth(manager)).send({ sku: 'PRODTEST-X', price: 0 })
    expect(res.status).toBe(422)
    const fields = res.body.error.details.map((d) => d.field)
    expect(fields).toEqual(expect.arrayContaining(['name', 'category_id', 'price']))
  })

  it('returns 404 for a category that does not exist', async () => {
    const res = await request(app).post('/api/products').set(auth(manager))
      .send({ name: 'Orphan', sku: 'PRODTEST-ORPHAN', category_id: '00000000-0000-0000-0000-000000000000', price: 1 })
    expect(res.status).toBe(404)
  })

  it('is forbidden for cashiers', async () => {
    const res = await request(app).post('/api/products').set(auth(cashier))
      .send({ name: 'Nope', sku: 'PRODTEST-NOPE', category_id: category.id, price: 1 })
    expect(res.status).toBe(403)
  })
})

describe('PUT /api/products/:id', () => {
  it('updates fields but never stock quantity', async () => {
    const res = await request(app).put(`/api/products/${product.id}`).set(auth(manager))
      .send({ name: 'ProdTest Alpha Renamed', price: 11, quantity: 999 })
    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('ProdTest Alpha Renamed')
    expect(res.body.data.quantity).toBe(5)
  })

  it('clears the image when image_url is null, and rejects setting a URL', async () => {
    await prisma.product.update({ where: { id: product.id }, data: { image_url: '/uploads/products/old.png' } })
    const cleared = await request(app).put(`/api/products/${product.id}`).set(auth(manager)).send({ image_url: null })
    expect(cleared.body.data.image_url).toBeNull()

    const setUrl = await request(app).put(`/api/products/${product.id}`).set(auth(manager)).send({ image_url: 'https://evil.example/x.png' })
    expect(setUrl.status).toBe(422)
  })

  it('rejects a SKU used by another product', async () => {
    const other = await prisma.product.create({ data: { name: 'ProdTest Other', sku: 'PRODTEST-OTHER', category_id: category.id, price: 1 } })
    const res = await request(app).put(`/api/products/${other.id}`).set(auth(manager)).send({ sku: 'PRODTEST-A' })
    expect(res.status).toBe(409)
  })

  it('returns 404 for an unknown product', async () => {
    const res = await request(app).put('/api/products/00000000-0000-0000-0000-000000000000').set(auth(manager)).send({ name: 'X' })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/products/:id (soft delete)', () => {
  it('is admin only', async () => {
    expect((await request(app).delete(`/api/products/${product.id}`).set(auth(manager))).status).toBe(403)
  })

  it('deactivates the product, and an admin can reactivate it', async () => {
    const del = await request(app).delete(`/api/products/${product.id}`).set(auth(admin))
    expect(del.status).toBe(200)
    expect((await prisma.product.findUnique({ where: { id: product.id } })).is_active).toBe(false)
    expect((await request(app).get('/api/products/barcode/9990000000011').set(auth(cashier))).status).toBe(404)

    const re = await request(app).put(`/api/products/${product.id}`).set(auth(admin)).send({ is_active: true })
    expect(re.body.data.is_active).toBe(true)
  })
})

describe('Categories', () => {
  it('lists categories with product counts', async () => {
    const res = await request(app).get('/api/categories').set(auth(cashier))
    const mine = res.body.data.find((c) => c.id === category.id)
    expect(mine._count.products).toBeGreaterThan(0)
  })

  it('creates, rejects duplicates, and updates', async () => {
    const created = await request(app).post('/api/categories').set(auth(manager)).send({ name: 'ProdTest New', description: 'x' })
    expect(created.status).toBe(201)

    const dup = await request(app).post('/api/categories').set(auth(manager)).send({ name: 'ProdTest New' })
    expect(dup.status).toBe(409)

    const updated = await request(app).put(`/api/categories/${created.body.data.id}`).set(auth(manager)).send({ name: 'ProdTest Renamed' })
    expect(updated.body.data.name).toBe('ProdTest Renamed')

    const clash = await request(app).put(`/api/categories/${created.body.data.id}`).set(auth(manager)).send({ name: 'ProdTest Category' })
    expect(clash.status).toBe(409)
  })

  it('is forbidden for cashiers to create', async () => {
    expect((await request(app).post('/api/categories').set(auth(cashier)).send({ name: 'ProdTest Nope' })).status).toBe(403)
  })
})
