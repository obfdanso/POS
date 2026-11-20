import './loadEnv'
import type { Branch, Category, Product } from '@prisma/client'
import { app, prisma, request, createUserWithToken, deleteTestUsers, testBranch, createTestProduct, stockAt, type TestAccount } from './helpers'

const PREFIX = 'prodtest'
let admin: TestAccount, manager: TestAccount, cashier: TestAccount, category: Category, product: Product, home: Branch, other: Branch, otherManager: TestAccount

beforeAll(async () => {
  [admin, manager, cashier] = await Promise.all([
    createUserWithToken('ADMIN', PREFIX),
    createUserWithToken('MANAGER', PREFIX),
    createUserWithToken('CASHIER', PREFIX),
  ])
  category = await prisma.category.create({ data: { name: 'ProdTest Category' } })
  product = await createTestProduct(
    { name: 'ProdTest Alpha', sku: 'PRODTEST-A', barcode: '9990000000011', category_id: category.id, price: 10 },
    { quantity: 5 }
  )
  home = await testBranch()
  other = await prisma.branch.upsert({ where: { code: 'PTB' }, update: { is_active: true }, create: { name: 'ProdTest Branch', code: 'PTB' } })
  otherManager = await createUserWithToken('MANAGER', `${PREFIX}o`, { branchId: other.id })
})

afterAll(async () => {
  const products = await prisma.product.findMany({ where: { sku: { startsWith: 'PRODTEST' } }, select: { id: true } })
  await prisma.inventoryLog.deleteMany({ where: { product_id: { in: products.map((p: { id: string }) => p.id) } } })
  await prisma.branchStock.deleteMany({ where: { product_id: { in: products.map((p: { id: string }) => p.id) } } })
  await prisma.product.deleteMany({ where: { sku: { startsWith: 'PRODTEST' } } })
  await prisma.category.deleteMany({ where: { name: { startsWith: 'ProdTest' } } })
  await deleteTestUsers(PREFIX)
  await deleteTestUsers(`${PREFIX}o`)
  await prisma.$disconnect()
})

const auth = (who: TestAccount) => who.headers

describe('GET /api/products', () => {
  it('searches name, SKU, and barcode', async () => {
    for (const term of ['ProdTest Alpha', 'PRODTEST-A', '9990000000011']) {
      const res = await request(app).get(`/api/products?search=${term}`).set(auth(cashier))
      expect(res.status).toBe(200)
      expect(res.body.data.map((p: { id: string }) => p.id)).toContain(product.id)
    }
  })

  it('filters by category and paginates', async () => {
    const res = await request(app).get(`/api/products?category_id=${category.id}&per_page=1`).set(auth(cashier))
    expect(res.body.data).toHaveLength(1)
    expect(res.body.meta).toMatchObject({ page: 1, per_page: 1 })
  })

  it('sorts by price descending', async () => {
    const res = await request(app).get('/api/products?sort=price&order=desc&per_page=10').set(auth(manager))
    const prices = res.body.data.map((p: { price: string }) => parseFloat(p.price))
    expect(prices).toEqual([...prices].sort((a: number, b: number) => b - a))
  })

  it('caps per_page at 100', async () => {
    const res = await request(app).get('/api/products?per_page=101').set(auth(manager))
    expect(res.status).toBe(422)
  })

  it('only shows inactive products to managers and admins', async () => {
    const inactive = await createTestProduct({ name: 'ProdTest Hidden', sku: 'PRODTEST-HIDDEN', category_id: category.id, price: 1, is_active: false })
    const asCashier = await request(app).get('/api/products?status=inactive&search=ProdTest').set(auth(cashier))
    expect(asCashier.body.data.map((p: { id: string }) => p.id)).not.toContain(inactive.id)
    const asManager = await request(app).get('/api/products?status=inactive&search=ProdTest').set(auth(manager))
    expect(asManager.body.data.map((p: { id: string }) => p.id)).toEqual([inactive.id])
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
    expect(logs).toEqual([
      expect.objectContaining({ change_type: 'RESTOCK', quantity_change: 12, new_quantity: 12, branch_id: home.id, notes: 'Starting stock' }),
    ])
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
    const fields = res.body.error.details.map((d: { field: string }) => d.field)
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
  it('updates fields', async () => {
    const res = await request(app).put(`/api/products/${product.id}`).set(auth(manager))
      .send({ name: 'ProdTest Alpha Renamed', price: 11 })
    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('ProdTest Alpha Renamed')
    expect(res.body.data.quantity).toBe(5)
  })

  it('rejects stock quantity, which only changes through inventory', async () => {
    const res = await request(app).put(`/api/products/${product.id}`).set(auth(manager)).send({ quantity: 999 })
    expect(res.status).toBe(422)
    expect(await stockAt(product.id)).toBe(5)
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
    expect((await prisma.product.findUnique({ where: { id: product.id } }))!.is_active).toBe(false)
    expect((await request(app).get('/api/products/barcode/9990000000011').set(auth(cashier))).status).toBe(404)

    const re = await request(app).put(`/api/products/${product.id}`).set(auth(admin)).send({ is_active: true })
    expect(re.body.data.is_active).toBe(true)
  })
})

describe('Categories', () => {
  it('lists categories with product counts', async () => {
    const res = await request(app).get('/api/categories').set(auth(cashier))
    const mine = res.body.data.find((c: { id: string }) => c.id === category.id)
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

describe('Branch stock', () => {
  const at = (who: TestAccount, branch: Branch) => ({ ...who.headers, 'X-Branch-Id': branch.id })
  const allBranches = () => ({ Authorization: admin.headers.Authorization })

  it("lists only products stocked at the branch, with that branch's count", async () => {
    const onlyOther = await createTestProduct(
      { name: 'ProdTest Elsewhere', sku: 'PRODTEST-ELSE', barcode: '9990000000099', category_id: category.id, price: 2 },
      { quantity: 3, branchId: other.id }
    )
    const mine = await request(app).get('/api/products?search=ProdTest&per_page=100').set(auth(cashier))
    expect(mine.body.data.map((p: { id: string }) => p.id)).not.toContain(onlyOther.id)
    const theirs = await request(app).get('/api/products?search=ProdTest Elsewhere').set(auth(otherManager))
    expect(theirs.body.data[0]).toMatchObject({ id: onlyOther.id, quantity: 3 })
  })

  it('says a scanned product is not stocked here', async () => {
    const res = await request(app).get('/api/products/barcode/9990000000099').set(auth(cashier))
    expect(res.status).toBe(404)
    expect(res.body.error.message).toBe('Not stocked at this branch')
  })

  it('sums every branch in the admin all-branches view', async () => {
    await prisma.branchStock.create({ data: { branch_id: other.id, product_id: product.id, quantity: 7 } })
    const res = await request(app).get('/api/products?search=PRODTEST-A').set(allBranches())
    expect(res.body.data.find((p: { id: string }) => p.id === product.id).quantity).toBe(12)
    const detail = await request(app).get(`/api/products/${product.id}`).set(allBranches())
    expect(detail.body.data.stocks.map((s: { quantity: number }) => s.quantity).sort()).toEqual([5, 7])
  })

  it('keeps products no branch stocks when sorting all branches by stock', async () => {
    const nowhere = await prisma.product.create({ data: { name: 'ProdTest Nowhere', sku: 'PRODTEST-NOWHERE', category_id: category.id, price: 1 } })
    const asc = await request(app).get('/api/products?search=ProdTest&sort=quantity&order=asc&per_page=100').set(allBranches())
    expect(asc.status).toBe(200)
    expect(asc.body.data.map((p: { id: string }) => p.id)).toContain(nowhere.id)
    expect(asc.body.data.length).toBe(asc.body.meta.total)
    expect(asc.body.data[0].quantity).toBe(0)
    const desc = await request(app).get('/api/products?search=ProdTest&sort=quantity&order=desc&per_page=100').set(allBranches())
    expect(desc.body.data.at(-1).quantity).toBe(0)
    expect(desc.body.data.map((p: { id: string }) => p.id)).toContain(nowhere.id)
  })

  it('sorts by stock at the branch', async () => {
    const res = await request(app).get('/api/products?search=ProdTest&sort=quantity&order=desc&per_page=100').set(auth(manager))
    expect(res.status).toBe(200)
    const counts = res.body.data.map((p: { quantity: number }) => p.quantity)
    expect(counts).toEqual([...counts].sort((a: number, b: number) => b - a))
  })

  it("doesn't show staff another branch's stock on a product", async () => {
    await prisma.branchStock.upsert({
      where: { branch_id_product_id: { branch_id: other.id, product_id: product.id } },
      create: { branch_id: other.id, product_id: product.id, quantity: 7 },
      update: {},
    })
    for (const who of [cashier, manager]) {
      const res = await request(app).get(`/api/products/${product.id}`).set(auth(who))
      expect(res.status).toBe(200)
      expect(res.body.data.stocks.map((s: { branch_id: string }) => s.branch_id)).toEqual([home.id])
    }
  })

  it('stocks a new product at the branches chosen, logging starting stock at each', async () => {
    const res = await request(app).post('/api/products').set(allBranches())
      .send({
        name: 'ProdTest Chain', sku: 'PRODTEST-CHAIN', category_id: category.id, price: 4,
        stocks: [{ branch_id: home.id, quantity: 6, low_stock_threshold: 2 }, { branch_id: other.id, quantity: 0 }],
      })
    expect(res.status).toBe(201)
    expect(await stockAt(res.body.data.id, home.id)).toBe(6)
    expect(await stockAt(res.body.data.id, other.id)).toBe(0)
    const logs = await prisma.inventoryLog.findMany({ where: { product_id: res.body.data.id } })
    expect(logs).toEqual([expect.objectContaining({ branch_id: home.id, quantity_change: 6, notes: 'Starting stock' })])
  })

  it('stocks a new product at every open branch when an admin does not say', async () => {
    const res = await request(app).post('/api/products').set(allBranches())
      .send({ name: 'ProdTest Everywhere', sku: 'PRODTEST-ALL', category_id: category.id, price: 4 })
    expect(res.status).toBe(201)
    const openBranches = await prisma.branch.count({ where: { is_active: true } })
    expect(await prisma.branchStock.count({ where: { product_id: res.body.data.id } })).toBe(openBranches)
  })

  it("doesn't let a manager stock another branch", async () => {
    const res = await request(app).post('/api/products').set(auth(manager))
      .send({ name: 'ProdTest Sneaky', sku: 'PRODTEST-SNEAK', category_id: category.id, price: 4, stocks: [{ branch_id: other.id, quantity: 9 }] })
    expect(res.status).toBe(403)
    const edit = await request(app).put(`/api/products/${product.id}`).set(auth(manager)).send({ stocks: [{ branch_id: other.id }] })
    expect(edit.status).toBe(403)
  })

  it('starts stocking a product at a branch from the edit form, and stops when it has none', async () => {
    const created = await createTestProduct({ name: 'ProdTest Toggle', sku: 'PRODTEST-TOG', category_id: category.id, price: 1 }, { quantity: 0 })
    const add = await request(app).put(`/api/products/${created.id}`).set(at(otherManager, other))
      .send({ stocks: [{ branch_id: other.id, quantity: 4, low_stock_threshold: 1 }] })
    expect(add.status).toBe(200)
    expect(await stockAt(created.id, other.id)).toBe(4)
    // The manager only manages their own branch's row, so home's row is untouched
    expect(await stockAt(created.id, home.id)).toBe(0)

    const refuse = await request(app).put(`/api/products/${created.id}`).set(at(otherManager, other)).send({ stocks: [] })
    expect(refuse.status).toBe(422)
    expect(refuse.body.error.details[0]).toMatchObject({ field: 'stocks', message: '"ProdTest Branch" still has 4 in stock' })

    const stop = await request(app).put(`/api/products/${created.id}`).set(auth(manager)).send({ stocks: [] })
    expect(stop.status).toBe(200)
    expect(await stockAt(created.id, home.id)).toBeNull()
  })

  it('accepts the stock list as JSON text, as sent with an image upload', async () => {
    const res = await request(app).post('/api/products').set(auth(manager))
      .field('name', 'ProdTest Form')
      .field('sku', 'PRODTEST-FORM')
      .field('category_id', category.id)
      .field('price', '2')
      .field('stocks', JSON.stringify([{ branch_id: home.id, quantity: 2 }]))
    expect(res.status).toBe(201)
    expect(await stockAt(res.body.data.id, home.id)).toBe(2)
  })

  it('leaves a closed branch\'s stock alone when an admin saves the branch list', async () => {
    const shut = await prisma.branch.upsert({ where: { code: 'PTX' }, update: {}, create: { name: 'ProdTest Shut', code: 'PTX' } })
    const p = await createTestProduct({ name: 'ProdTest Closed', sku: 'PRODTEST-CLOSED', category_id: category.id, price: 1 }, { quantity: 1 })
    await prisma.branchStock.create({ data: { branch_id: shut.id, product_id: p.id, quantity: 3 } })
    await prisma.branch.update({ where: { id: shut.id }, data: { is_active: false } })
    try {
      const res = await request(app).put(`/api/products/${p.id}`).set(allBranches()).send({ stocks: [{ branch_id: home.id }] })
      expect(res.status).toBe(200)
      expect(await stockAt(p.id, shut.id)).toBe(3)
    } finally {
      await prisma.branchStock.deleteMany({ where: { branch_id: shut.id } })
      await prisma.branch.delete({ where: { id: shut.id } })
    }
  })

  it('asks an admin viewing all branches which branch a starting quantity or low-stock level is for', async () => {
    const create = await request(app).post('/api/products').set(allBranches())
      .send({ name: 'ProdTest Where', sku: 'PRODTEST-WHERE', category_id: category.id, price: 4, quantity: 50 })
    expect(create.status).toBe(422)
    expect(create.body.error.details[0].field).toBe('quantity')
    const update = await request(app).put(`/api/products/${product.id}`).set(allBranches()).send({ low_stock_threshold: 2 })
    expect(update.status).toBe(422)
    expect(update.body.error.details[0].field).toBe('low_stock_threshold')
  })

  it('sets the low-stock level for the acting branch only', async () => {
    const res = await request(app).put(`/api/products/${product.id}`).set(auth(manager)).send({ low_stock_threshold: 3 })
    expect(res.status).toBe(200)
    expect(res.body.data.low_stock_threshold).toBe(3)
    const otherRow = await prisma.branchStock.findUnique({ where: { branch_id_product_id: { branch_id: other.id, product_id: product.id } } })
    expect(otherRow!.low_stock_threshold).toBe(10)
  })
})
