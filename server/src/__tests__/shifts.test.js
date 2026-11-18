require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { app, prisma, request, createUserWithToken, deleteTestUsers } = require('./helpers')
const { verifyPaystackPayment } = require('../utils/paystack')

jest.mock('../utils/paystack', () => ({ verifyPaystackPayment: jest.fn() }))

const PREFIX = 'shifttest'
const TEST_SETTINGS = { tax_rate: '0', loyalty_points_rate: '10', require_open_shift: 'false' }
let manager, cashier, otherCashier, category, product, originalSettings

const auth = (who) => ({ Authorization: `Bearer ${who.token}` })
const openShift = (who, body) => request(app).post('/api/shifts/open').set(auth(who)).send(body)
const closeShift = (who, id, body) => request(app).post(`/api/shifts/${id}/close`).set(auth(who)).send(body)
const sell = (who, body) => request(app).post('/api/sales').set(auth(who)).send(body)
const setSetting = (key, value) => prisma.settings.update({ where: { key }, data: { value } })

beforeAll(async () => {
  originalSettings = await prisma.settings.findMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const [key, value] of Object.entries(TEST_SETTINGS)) {
    await prisma.settings.upsert({ where: { key }, update: { value }, create: { key, value } })
  }
  [manager, cashier] = await Promise.all([createUserWithToken('MANAGER', PREFIX), createUserWithToken('CASHIER', PREFIX)])
  otherCashier = await createUserWithToken('CASHIER', `${PREFIX}2`)
  category = await prisma.category.create({ data: { name: 'ShiftTest Category' } })
  product = await prisma.product.create({
    data: { name: 'ShiftTest Item', sku: 'SHIFTTEST-1', category_id: category.id, price: 10, quantity: 500 },
  })
})

afterAll(async () => {
  const userIds = (
    await prisma.user.findMany({ where: { username: { startsWith: PREFIX } }, select: { id: true } })
  ).map((u) => u.id)
  await prisma.auditLog.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.inventoryLog.deleteMany({ where: { product_id: product.id } })
  await prisma.sale.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.shift.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.product.deleteMany({ where: { sku: { startsWith: 'SHIFTTEST' } } })
  await prisma.category.deleteMany({ where: { name: { startsWith: 'ShiftTest' } } })
  await deleteTestUsers(PREFIX)
  await deleteTestUsers(`${PREFIX}2`)
  await prisma.settings.deleteMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const { key, value } of originalSettings) await prisma.settings.create({ data: { key, value } })
  await prisma.$disconnect()
})

describe('Shifts', () => {
  let shift

  it('opens a shift with a float, and only one at a time', async () => {
    const res = await openShift(cashier, { opening_float: 200 })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ status: 'OPEN', user_id: cashier.user.id })
    expect(res.body.data.summary.expected_cash).toBe(200)
    shift = res.body.data

    const again = await openShift(cashier, { opening_float: 50 })
    expect(again.status).toBe(409)
  })

  it('rejects a negative float', async () => {
    const res = await openShift(otherCashier, { opening_float: -5 })
    expect(res.status).toBe(422)
  })

  it('links sales to the open shift and counts cash toward the drawer', async () => {
    const cash = await sell(cashier, { items: [{ product_id: product.id, quantity: 3 }], payment_method: 'CASH', amount_paid: 50 })
    expect(cash.status).toBe(201)
    expect(cash.body.data.shift_id).toBe(shift.id)

    verifyPaystackPayment.mockResolvedValueOnce({ status: true, data: { status: 'success', amount: 1000, currency: 'GHS' } })
    const card = await sell(cashier, { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'CARD', amount_paid: 10, reference: 'SHIFTTEST-CARD-1' })
    expect(card.status).toBe(201)

    const current = await request(app).get('/api/shifts/current').set(auth(cashier))
    expect(current.body.data.summary).toMatchObject({
      sales_count: 2,
      sales_total: 40,
      cash_sales: 30,
      expected_cash: 230,
      by_method: { CASH: { count: 1, total: 30 }, CARD: { count: 1, total: 10 } },
    })
  })

  it('stops other cashiers from viewing or closing the shift', async () => {
    expect((await request(app).get(`/api/shifts/${shift.id}`).set(auth(otherCashier))).status).toBe(403)
    expect((await closeShift(otherCashier, shift.id, { counted_cash: 0 })).status).toBe(403)
  })

  it('closes with the counted cash and records the difference', async () => {
    const res = await closeShift(cashier, shift.id, { counted_cash: 225, notes: 'Short at close' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ status: 'CLOSED', closed_by_id: cashier.user.id, notes: 'Short at close' })
    expect(parseFloat(res.body.data.expected_cash)).toBe(230)
    expect(parseFloat(res.body.data.counted_cash)).toBe(225)
    expect(parseFloat(res.body.data.difference)).toBe(-5)

    const audit = await prisma.auditLog.findFirst({ where: { entity_id: shift.id, action: 'SHIFT_CLOSED' } })
    expect(audit.details).toContain('short by 5.00')

    expect((await closeShift(cashier, shift.id, { counted_cash: 230 })).status).toBe(422)
    expect((await request(app).get('/api/shifts/current').set(auth(cashier))).body.data).toBeNull()
  })

  it('does not link sales made with no shift open', async () => {
    const res = await sell(cashier, { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'CASH', amount_paid: 10 })
    expect(res.status).toBe(201)
    expect(res.body.data.shift_id).toBeNull()
  })

  it('blocks sales without an open shift when the setting requires one', async () => {
    await setSetting('require_open_shift', 'true')
    try {
      const blocked = await sell(cashier, { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'CASH', amount_paid: 10 })
      expect(blocked.status).toBe(422)
      expect(blocked.body.error.details[0].field).toBe('shift')

      const opened = await openShift(cashier, { opening_float: 0 })
      const allowed = await sell(cashier, { items: [{ product_id: product.id, quantity: 1 }], payment_method: 'CASH', amount_paid: 10 })
      expect(allowed.status).toBe(201)
      expect(allowed.body.data.shift_id).toBe(opened.body.data.id)

      // A manager can close a cashier's shift
      const closed = await closeShift(manager, opened.body.data.id, { counted_cash: 10 })
      expect(closed.status).toBe(200)
      expect(closed.body.data.closed_by_id).toBe(manager.user.id)
      expect(parseFloat(closed.body.data.difference)).toBe(0)
    } finally {
      await setSetting('require_open_shift', 'false')
    }
  })

  it('lists only their own shifts to cashiers, and everyone\'s to managers', async () => {
    await openShift(otherCashier, { opening_float: 20 })
    const own = await request(app).get('/api/shifts').set(auth(cashier))
    expect(own.status).toBe(200)
    expect(own.body.data.every((s) => s.user_id === cashier.user.id)).toBe(true)
    expect(own.body.data[0]).toHaveProperty('sales_count')

    const all = await request(app).get(`/api/shifts?status=OPEN&user_id=${otherCashier.user.id}`).set(auth(manager))
    expect(all.body.data).toHaveLength(1)
    expect(all.body.meta.total).toBe(1)
  })
})
