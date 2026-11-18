require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { app, prisma, request, createUserWithToken, deleteTestUsers } = require('./helpers')

const PREFIX = 'varianttest'
const TEST_SETTINGS = { tax_rate: '0', require_open_shift: 'false' }
let manager, cashier, category, otherCategory, main, originalSettings

const auth = (who) => ({ Authorization: `Bearer ${who.token}` })
const create = (body) => request(app).post('/api/products').set(auth(manager)).send(body)
const update = (id, body) => request(app).put(`/api/products/${id}`).set(auth(manager)).send(body)
const variant = (overrides = {}) =>
  create({ name: 'VariantTest Juice 1L', sku: `VARTEST-${Date.now()}-${Math.random()}`, category_id: category.id, price: 12, quantity: 5, parent_id: main.id, variant_name: '1L', ...overrides })

beforeAll(async () => {
  originalSettings = await prisma.settings.findMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const [key, value] of Object.entries(TEST_SETTINGS)) {
    await prisma.settings.upsert({ where: { key }, update: { value }, create: { key, value } })
  }
  manager = await createUserWithToken('MANAGER', PREFIX)
  cashier = await createUserWithToken('CASHIER', `${PREFIX}2`)
  category = await prisma.category.create({ data: { name: 'VariantTest Category' } })
  otherCategory = await prisma.category.create({ data: { name: 'VariantTest Other' } })
  main = (await create({ name: 'VariantTest Juice 500ml', sku: 'VARTEST-MAIN', category_id: category.id, price: 7, quantity: 10, variant_name: '500ml' })).body.data
})

afterAll(async () => {
  const userIds = (await prisma.user.findMany({ where: { username: { startsWith: PREFIX } }, select: { id: true } })).map((u) => u.id)
  const products = await prisma.product.findMany({ where: { sku: { startsWith: 'VARTEST' } }, select: { id: true } })
  const productIds = products.map((p) => p.id)
  await prisma.auditLog.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.inventoryLog.deleteMany({ where: { product_id: { in: productIds } } })
  await prisma.sale.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.product.deleteMany({ where: { parent_id: { in: productIds } } })
  await prisma.product.deleteMany({ where: { id: { in: productIds } } })
  await prisma.category.deleteMany({ where: { name: { startsWith: 'VariantTest' } } })
  await deleteTestUsers(PREFIX)
  await deleteTestUsers(`${PREFIX}2`)
  await prisma.settings.deleteMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const { key, value } of originalSettings) await prisma.settings.create({ data: { key, value } })
  await prisma.$disconnect()
})

describe('Product variants', () => {
  let oneLitre

  it('creates a variant under a main product, with its own stock and opening stock log', async () => {
    const res = await variant()
    expect(res.status).toBe(201)
    oneLitre = res.body.data
    expect(oneLitre).toMatchObject({ parent_id: main.id, variant_name: '1L', quantity: 5, parent: { id: main.id, name: main.name } })
    const log = await prisma.inventoryLog.findFirst({ where: { product_id: oneLitre.id } })
    expect(log.quantity_change).toBe(5)
  })

  it('lists the variants on the main product and the main product on each variant', async () => {
    const res = await request(app).get(`/api/products/${main.id}`).set(auth(cashier))
    expect(res.body.data.variants.map((v) => v.variant_name)).toEqual(['1L'])
    const child = await request(app).get(`/api/products/${oneLitre.id}`).set(auth(cashier))
    expect(child.body.data.parent.variant_name).toBe('500ml')
  })

  it('groups variants under their main product for the till, but finds them directly by search', async () => {
    const grouped = await request(app).get(`/api/products?group_variants=true&category_id=${category.id}`).set(auth(cashier))
    expect(grouped.status).toBe(200)
    expect(grouped.body.data.map((p) => p.id)).toEqual([main.id])
    expect(grouped.body.data[0].variants.map((v) => v.id)).toEqual([oneLitre.id])

    const searched = await request(app).get(`/api/products?search=${encodeURIComponent(oneLitre.sku)}`).set(auth(cashier))
    expect(searched.body.data.map((p) => p.id)).toEqual([oneLitre.id])
  })

  it('leaves inactive variants out of the till listing', async () => {
    const extra = (await variant({ variant_name: '2L', name: 'VariantTest Juice 2L', is_active: false })).body.data
    const grouped = await request(app).get(`/api/products?group_variants=true&category_id=${category.id}`).set(auth(cashier))
    expect(grouped.body.data[0].variants.map((v) => v.id)).not.toContain(extra.id)
  })

  it('sells a variant like any product', async () => {
    const res = await request(app).post('/api/sales').set(auth(cashier)).send({
      items: [{ product_id: oneLitre.id, quantity: 2 }], payment_method: 'CASH', amount_paid: 24,
    })
    expect(res.status).toBe(201)
    expect((await prisma.product.findUnique({ where: { id: oneLitre.id } })).quantity).toBe(3)
    expect((await prisma.product.findUnique({ where: { id: main.id } })).quantity).toBe(10)
  })

  it('rejects a variant without a name, of a variant, in another category, or of a missing product', async () => {
    const noName = await variant({ variant_name: '  ' })
    expect(noName.status).toBe(422)
    expect(noName.body.error.details[0].field).toBe('variant_name')

    const nested = await variant({ parent_id: oneLitre.id, variant_name: 'Big' })
    expect(nested.status).toBe(422)
    expect(nested.body.error.details[0].message).toMatch(/cannot have variants/)

    const otherCat = await variant({ category_id: otherCategory.id, variant_name: '3L' })
    expect(otherCat.status).toBe(422)
    expect(otherCat.body.error.details[0].field).toBe('category_id')

    const missing = await variant({ parent_id: '00000000-0000-0000-0000-000000000000', variant_name: '4L' })
    expect(missing.status).toBe(422)
  })

  it('rejects an option name already used in the group, ignoring case', async () => {
    expect((await variant({ variant_name: '1l' })).status).toBe(409)
    expect((await variant({ variant_name: '500ML' })).status).toBe(409)
    expect((await update(main.id, { variant_name: '1L' })).status).toBe(409)
    expect((await update(oneLitre.id, { variant_name: '1 Litre' })).status).toBe(200)
  })

  it("can't clear a variant's name or move it to another category, or change its main product", async () => {
    expect((await update(oneLitre.id, { variant_name: '' })).status).toBe(422)
    expect((await update(oneLitre.id, { category_id: otherCategory.id })).status).toBe(422)
    expect((await update(oneLitre.id, { parent_id: null })).status).toBe(422)
  })

  it('moves the variants when the main product changes category', async () => {
    const res = await update(main.id, { category_id: otherCategory.id })
    expect(res.status).toBe(200)
    const moved = await prisma.product.findMany({ where: { parent_id: main.id }, select: { category_id: true } })
    expect(moved.every((v) => v.category_id === otherCategory.id)).toBe(true)
    await update(main.id, { category_id: category.id })
  })

  it('stops cashiers creating variants', async () => {
    const res = await request(app).post('/api/products').set(auth(cashier))
      .send({ name: 'x', sku: 'VARTEST-CASHIER', category_id: category.id, price: 1, parent_id: main.id, variant_name: 'x' })
    expect(res.status).toBe(403)
  })
})
