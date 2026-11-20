require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { app, prisma, request, createUserWithToken, deleteTestUsers, stockAt } = require('./helpers')

const PREFIX = 'potest'
let manager, cashier, supplier, otherSupplier, category, rice, oil, soap

const auth = (who) => who.headers
const api = {
  create: (body, who = manager) => request(app).post('/api/purchase-orders').set(auth(who)).send(body),
  receive: (id, body = {}) => request(app).post(`/api/purchase-orders/${id}/receive`).set(auth(manager)).send(body),
  cancel: (id, body = {}) => request(app).post(`/api/purchase-orders/${id}/cancel`).set(auth(manager)).send(body),
  get: (id) => request(app).get(`/api/purchase-orders/${id}`).set(auth(manager)),
}
// A product with its stock at the test branch
const product = async (id) => ({ ...(await prisma.product.findUnique({ where: { id } })), quantity: await stockAt(id) })

beforeAll(async () => {
  manager = await createUserWithToken('MANAGER', PREFIX)
  cashier = await createUserWithToken('CASHIER', PREFIX)
  supplier = await prisma.supplier.create({ data: { name: 'POTest Wholesale' } })
  otherSupplier = await prisma.supplier.create({ data: { name: 'POTest Other' } })
  category = await prisma.category.create({ data: { name: 'POTest Category' } })
  const make = (name, sku, quantity, threshold, cost) =>
    prisma.product.create({
      data: { name, sku, category_id: category.id, supplier_id: supplier.id, price: 50, cost_price: cost, quantity, low_stock_threshold: threshold },
    })
  rice = await make('POTest Rice 5kg', 'POTEST-RICE', 2, 10, 30)
  oil = await make('POTest Oil 1L', 'POTEST-OIL', 4, 5, 20)
  soap = await make('POTest Soap', 'POTEST-SOAP', 100, 10, 3)
})

afterAll(async () => {
  const userIds = (await prisma.user.findMany({ where: { username: { startsWith: PREFIX } }, select: { id: true } })).map((u) => u.id)
  const productIds = [rice.id, oil.id, soap.id]
  await prisma.purchaseOrder.deleteMany({ where: { supplier_id: { in: [supplier.id, otherSupplier.id] } } })
  await prisma.auditLog.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.inventoryLog.deleteMany({ where: { product_id: { in: productIds } } })
  await prisma.product.deleteMany({ where: { id: { in: productIds } } })
  await prisma.category.deleteMany({ where: { id: category.id } })
  await prisma.supplier.deleteMany({ where: { id: { in: [supplier.id, otherSupplier.id] } } })
  await deleteTestUsers(PREFIX)
  await prisma.$disconnect()
})

describe('Purchase orders', () => {
  let po

  it('suggests low-stock items from a supplier, topped up to twice their threshold', async () => {
    const res = await request(app).get(`/api/purchase-orders/suggestions?supplier_id=${supplier.id}`).set(auth(manager))
    expect(res.status).toBe(200)
    expect(res.body.data.map((s) => [s.sku, s.suggested_quantity, s.unit_cost])).toEqual([
      ['POTEST-RICE', 18, 30], // 2 × 10 − 2 in stock
      ['POTEST-OIL', 6, 20], // 2 × 5 − 4
    ])
  })

  it('creates an order with a PO number and total cost', async () => {
    const res = await api.create({
      supplier_id: supplier.id,
      items: [
        { product_id: rice.id, quantity: 20, unit_cost: 32.5 },
        { product_id: oil.id, quantity: 6, unit_cost: 21 },
      ],
      expected_at: '2026-12-01',
      notes: 'Deliver to back door',
    })
    expect(res.status).toBe(201)
    po = res.body.data
    expect(po.po_number).toMatch(/^PO-\d{8}-\d{4}$/)
    expect(po.status).toBe('ORDERED')
    expect(parseFloat(po.total_cost)).toBe(776) // 20 × 32.50 + 6 × 21
    expect(po.items).toHaveLength(2)
    expect(po.units_ordered).toBe(26)
  })

  it('counts open orders in later suggestions so stock is not ordered twice', async () => {
    const res = await request(app).get(`/api/purchase-orders/suggestions?supplier_id=${supplier.id}`).set(auth(manager))
    expect(res.body.data).toEqual([])
  })

  it('receives part of a delivery: adds stock, logs it, and updates the cost price', async () => {
    const riceLine = po.items.find((i) => i.product_id === rice.id)
    const res = await api.receive(po.id, { items: [{ item_id: riceLine.id, quantity: 12 }], notes: 'First van' })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('PARTIALLY_RECEIVED')
    expect(res.body.data.items.find((i) => i.id === riceLine.id)).toMatchObject({ quantity_received: 12, quantity_outstanding: 8 })
    const after = await product(rice.id)
    expect(after.quantity).toBe(14)
    expect(parseFloat(after.cost_price)).toBe(32.5)
    const log = await prisma.inventoryLog.findFirst({ where: { product_id: rice.id, change_type: 'RESTOCK' } })
    expect(log).toMatchObject({ quantity_change: 12, previous_quantity: 2, new_quantity: 14 })
    expect(log.notes).toBe(`Received on ${po.po_number}: First van`)
  })

  it('rejects receiving more than is outstanding or an item from another order', async () => {
    const riceLine = po.items.find((i) => i.product_id === rice.id)
    expect((await api.receive(po.id, { items: [{ item_id: riceLine.id, quantity: 9 }] })).status).toBe(422)
    expect((await api.receive(po.id, { items: [{ item_id: '00000000-0000-4000-8000-000000000000', quantity: 1 }] })).status).toBe(422)
    expect((await api.receive(po.id, { items: [{ item_id: riceLine.id, quantity: 0 }] })).status).toBe(422)
    expect((await product(rice.id)).quantity).toBe(14)
  })

  it('receives everything outstanding when no items are given, keeping the cost price if asked', async () => {
    const res = await api.receive(po.id, { update_cost: false })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('RECEIVED')
    expect(res.body.data.received_at).not.toBeNull()
    expect((await product(rice.id)).quantity).toBe(22)
    const oilAfter = await product(oil.id)
    expect(oilAfter.quantity).toBe(10)
    expect(parseFloat(oilAfter.cost_price)).toBe(20) // unchanged
    expect((await api.receive(po.id)).status).toBe(422) // closed
  })

  it('never adds stock twice when the same delivery is received at the same moment', async () => {
    const created = await api.create({ supplier_id: supplier.id, items: [{ product_id: soap.id, quantity: 10, unit_cost: 3 }] })
    const before = (await product(soap.id)).quantity
    const results = await Promise.all([api.receive(created.body.data.id), api.receive(created.body.data.id)])
    expect(results.map((r) => r.status).sort()).toEqual([200, 422])
    expect((await product(soap.id)).quantity).toBe(before + 10)
  })

  it('cancels an open order but not a finished one', async () => {
    const created = await api.create({ supplier_id: supplier.id, items: [{ product_id: soap.id, quantity: 5, unit_cost: 3 }] })
    const res = await api.cancel(created.body.data.id, { reason: 'Supplier out of stock' })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('CANCELLED')
    expect((await api.receive(created.body.data.id)).status).toBe(422)
    expect((await api.cancel(po.id)).status).toBe(422)
    expect(await prisma.auditLog.count({ where: { action: 'PURCHASE_ORDER_CANCELLED', entity_id: created.body.data.id } })).toBe(1)
  })

  it('validates new orders', async () => {
    const line = { product_id: rice.id, quantity: 1, unit_cost: 1 }
    expect((await api.create({ supplier_id: '00000000-0000-4000-8000-000000000000', items: [line] })).status).toBe(422)
    expect((await api.create({ supplier_id: supplier.id, items: [] })).status).toBe(422)
    expect((await api.create({ supplier_id: supplier.id, items: [line, line] })).status).toBe(422)
    expect((await api.create({ supplier_id: supplier.id, items: [{ ...line, quantity: 0 }] })).status).toBe(422)
    expect((await api.create({ supplier_id: supplier.id, items: [{ ...line, unit_cost: -1 }] })).status).toBe(422)
    expect((await api.create({ supplier_id: supplier.id, items: [line], total_cost: 1 })).status).toBe(422)
  })

  it('lists orders with filters and progress, for managers only', async () => {
    const res = await request(app).get(`/api/purchase-orders?supplier_id=${supplier.id}&status=RECEIVED`).set(auth(manager))
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBeGreaterThanOrEqual(2)
    const row = res.body.data.find((o) => o.id === po.id)
    expect(row).toMatchObject({ item_count: 2, units_ordered: 26, units_received: 26, supplier: { name: 'POTest Wholesale' } })
    expect(res.body.meta.total).toBe(res.body.data.length)

    expect((await request(app).get('/api/purchase-orders').set(auth(cashier))).status).toBe(403)
    expect((await api.create({ supplier_id: supplier.id, items: [{ product_id: rice.id, quantity: 1, unit_cost: 1 }] }, cashier)).status).toBe(403)
  })

  it('keeps a supplier that has purchase orders from being deleted', async () => {
    const admin = await createUserWithToken('ADMIN', PREFIX)
    await prisma.product.updateMany({ where: { supplier_id: supplier.id }, data: { supplier_id: null } })
    const res = await request(app).delete(`/api/suppliers/${supplier.id}`).set(auth(admin))
    expect(res.status).toBe(409)
    await prisma.product.updateMany({ where: { id: { in: [rice.id, oil.id, soap.id] } }, data: { supplier_id: supplier.id } })
  })
})
