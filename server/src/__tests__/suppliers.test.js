require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { app, prisma, request, createUserWithToken, deleteTestUsers } = require('./helpers')

const PREFIX = 'supptest'
let admin, manager, cashier, category

beforeAll(async () => {
  [admin, manager, cashier] = await Promise.all([
    createUserWithToken('ADMIN', PREFIX),
    createUserWithToken('MANAGER', PREFIX),
    createUserWithToken('CASHIER', PREFIX),
  ])
  category = await prisma.category.create({ data: { name: 'SuppTest Category' } })
})

afterAll(async () => {
  await prisma.product.deleteMany({ where: { sku: { startsWith: 'SUPPTEST' } } })
  await prisma.supplier.deleteMany({ where: { name: { startsWith: 'SuppTest' } } })
  await prisma.category.deleteMany({ where: { name: 'SuppTest Category' } })
  await deleteTestUsers(PREFIX)
  await prisma.$disconnect()
})

const auth = (who) => ({ Authorization: `Bearer ${who.token}` })

describe('Suppliers', () => {
  let supplierId

  it('creates a supplier (manager)', async () => {
    const res = await request(app).post('/api/suppliers').set(auth(manager))
      .send({ name: 'SuppTest Ltd', phone: '030-000-0000', email: 'orders@supptest.local', address: 'Tema', website: 'supptest.local' })
    expect(res.status).toBe(201)
    supplierId = res.body.data.id
  })

  it('rejects a duplicate name and an invalid email', async () => {
    expect((await request(app).post('/api/suppliers').set(auth(manager)).send({ name: 'SuppTest Ltd' })).status).toBe(409)
    expect((await request(app).post('/api/suppliers').set(auth(manager)).send({ name: 'SuppTest Two', email: 'nope' })).status).toBe(422)
  })

  it('lists and searches suppliers with active product counts', async () => {
    await prisma.product.create({ data: { name: 'SuppTest Item', sku: 'SUPPTEST-1', category_id: category.id, supplier_id: supplierId, price: 1 } })
    const res = await request(app).get('/api/suppliers?search=SuppTest').set(auth(cashier))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([expect.objectContaining({ id: supplierId, product_count: 1 })])
    expect(res.body.meta.total).toBe(1)
  })

  it('returns a supplier with its products, or 404', async () => {
    const res = await request(app).get(`/api/suppliers/${supplierId}`).set(auth(cashier))
    expect(res.body.data.products.map((p) => p.sku)).toEqual(['SUPPTEST-1'])
    expect((await request(app).get('/api/suppliers/00000000-0000-0000-0000-000000000000').set(auth(cashier))).status).toBe(404)
  })

  it('updates a supplier', async () => {
    const res = await request(app).put(`/api/suppliers/${supplierId}`).set(auth(manager)).send({ name: 'SuppTest Ltd', phone: '030-111-1111' })
    expect(res.status).toBe(200)
    expect(res.body.data.phone).toBe('030-111-1111')
  })

  it('refuses to delete a supplier that active products still use', async () => {
    const res = await request(app).delete(`/api/suppliers/${supplierId}`).set(auth(admin))
    expect(res.status).toBe(409)
  })

  it('lets only admins delete, once no active products remain', async () => {
    await prisma.product.updateMany({ where: { supplier_id: supplierId }, data: { is_active: false } })
    expect((await request(app).delete(`/api/suppliers/${supplierId}`).set(auth(manager))).status).toBe(403)
    expect((await request(app).delete(`/api/suppliers/${supplierId}`).set(auth(admin))).status).toBe(200)
    expect((await request(app).put(`/api/suppliers/${supplierId}`).set(auth(manager)).send({ name: 'SuppTest Ltd' })).status).toBe(404)
  })

  it('is read-only for cashiers', async () => {
    expect((await request(app).post('/api/suppliers').set(auth(cashier)).send({ name: 'SuppTest Nope' })).status).toBe(403)
  })
})
