import './loadEnv'
import type { Category, Product, Settings } from '@prisma/client'
import { app, prisma, request, createUserWithToken, deleteTestUsers, inTestBranch, type TestAccount } from './helpers'
import { verifyPaystackPayment } from '../utils/paystack'

jest.mock('../utils/paystack', () => ({ verifyPaystackPayment: jest.fn() }))

const PREFIX = 'splittest'
const TEST_SETTINGS = { tax_rate: '0', require_open_shift: 'false' }
let manager: TestAccount, cashier: TestAccount, category: Category, product: Product, originalSettings: Settings[]

const auth = (who: TestAccount) => who.headers
const paystackOk = (amountGhs: number) =>
  jest.mocked(verifyPaystackPayment).mockResolvedValueOnce({ status: true, data: { status: 'success', amount: Math.round(amountGhs * 100), currency: 'GHS' } })
// Product costs 10.00, so 5 units are 50.00
const sell = (body: Record<string, unknown>, quantity = 5) =>
  request(app).post('/api/sales').set(auth(cashier)).send({ items: [{ product_id: product.id, quantity }], payment_method: 'SPLIT', ...body })
let refCounter = 0
const ref = () => `SPLIT-REF-${Date.now()}-${++refCounter}`

beforeAll(async () => {
  originalSettings = await prisma.settings.findMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const [key, value] of Object.entries(TEST_SETTINGS)) {
    await prisma.settings.upsert({ where: { key }, update: { value }, create: { key, value } })
  }
  manager = await createUserWithToken('MANAGER', PREFIX)
  cashier = await createUserWithToken('CASHIER', `${PREFIX}2`)
  category = await prisma.category.create({ data: { name: 'SplitTest Category' } })
  product = await prisma.product.create({
    data: { name: 'SplitTest Item', sku: 'SPLITTEST-1', category_id: category.id, price: 10, stocks: inTestBranch(500) },
  })
})

afterAll(async () => {
  const userIds = (await prisma.user.findMany({ where: { username: { startsWith: PREFIX } }, select: { id: true } })).map((u) => u.id)
  await prisma.auditLog.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.inventoryLog.deleteMany({ where: { product_id: product.id } })
  await prisma.sale.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.shift.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.product.deleteMany({ where: { id: product.id } })
  await prisma.category.deleteMany({ where: { id: category.id } })
  await deleteTestUsers(PREFIX)
  await deleteTestUsers(`${PREFIX}2`)
  await prisma.settings.deleteMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const { key, value } of originalSettings) await prisma.settings.create({ data: { key, value } })
  await prisma.$disconnect()
})

beforeEach(() => jest.mocked(verifyPaystackPayment).mockReset())

describe('Split payments', () => {
  it('takes part in cash and part by Mobile Money, giving change from the cash part', async () => {
    const reference = ref()
    paystackOk(20)
    const res = await sell({ payments: [{ method: 'CASH', amount: 40 }, { method: 'MOBILE_MONEY', amount: 20, reference }] })
    expect(res.status).toBe(201)
    expect(res.body.data.payment_method).toBe('SPLIT')
    expect(verifyPaystackPayment).toHaveBeenCalledWith(reference)

    const parts = res.body.data.payments
    expect(parts).toHaveLength(2)
    expect(parts[0]).toMatchObject({ method: 'CASH', amount_paid: '40', change_given: '10' })
    expect(parts[1]).toMatchObject({ method: 'MOBILE_MONEY', amount_paid: '20', change_given: '0', reference })
    expect(res.body.data.payment.method).toBe('CASH')
  })

  it('takes card and Mobile Money with no cash when they add up to the total', async () => {
    paystackOk(30)
    paystackOk(20)
    const res = await sell({ payments: [{ method: 'CARD', amount: 30, reference: ref() }, { method: 'MOBILE_MONEY', amount: 20, reference: ref() }] })
    expect(res.status).toBe(201)
    expect(res.body.data.payments.map((p: { method: string }) => p.method)).toEqual(['MOBILE_MONEY', 'CARD'])
  })

  it('rejects a Paystack charge that differs from its part', async () => {
    paystackOk(25)
    const res = await sell({ payments: [{ method: 'CASH', amount: 30 }, { method: 'CARD', amount: 20, reference: ref() }] })
    expect(res.status).toBe(422)
    expect(res.body.error.details[0].field).toBe('amount')
  })

  it('rejects too little cash for what is left to pay', async () => {
    const res = await sell({ payments: [{ method: 'CASH', amount: 29.99 }, { method: 'CARD', amount: 20, reference: ref() }] })
    expect(res.status).toBe(422)
    expect(res.body.error.details[0].message).toMatch(/less than the 30.00 left/)
    expect(verifyPaystackPayment).not.toHaveBeenCalled()
  })

  it('rejects parts that do not add up, a repeated method, a missing reference and a single part', async () => {
    const cases = [
      [{ method: 'CARD', amount: 30, reference: ref() }, { method: 'MOBILE_MONEY', amount: 10, reference: ref() }],
      [{ method: 'CASH', amount: 10 }, { method: 'CARD', amount: 50, reference: ref() }],
      [{ method: 'CASH', amount: 30 }, { method: 'CASH', amount: 20 }],
      [{ method: 'CASH', amount: 30 }, { method: 'CARD', amount: 20 }],
      [{ method: 'CASH', amount: 50 }],
    ]
    for (const payments of cases) {
      const res = await sell({ payments })
      expect(res.status).toBe(422)
    }
    expect(verifyPaystackPayment).not.toHaveBeenCalled()
  })

  it('rejects payments on a sale that is not split, and a split with no payments', async () => {
    const notSplit = await request(app).post('/api/sales').set(auth(cashier)).send({
      items: [{ product_id: product.id, quantity: 1 }], payment_method: 'CASH', amount_paid: 10, payments: [{ method: 'CASH', amount: 10 }],
    })
    expect(notSplit.status).toBe(422)
    expect((await sell({})).status).toBe(422)
  })

  it('counts each part in the shift, and refunds cash first from the drawer', async () => {
    const opened = await request(app).post('/api/shifts/open').set(auth(manager)).send({ opening_float: 100 })
    expect(opened.status).toBe(201)
    const cashierShift = await request(app).post('/api/shifts/open').set(auth(cashier)).send({ opening_float: 50 })
    expect(cashierShift.status).toBe(201)

    paystackOk(30)
    const sale = (await sell({ payments: [{ method: 'CASH', amount: 25 }, { method: 'CARD', amount: 30, reference: ref() }] })).body.data
    expect(sale.shift_id).toBe(cashierShift.body.data.id)

    const current = (await request(app).get('/api/shifts/current').set(auth(cashier))).body.data.summary
    expect(current).toMatchObject({
      sales_count: 1,
      sales_total: 50,
      split_count: 1,
      cash_sales: 20,
      expected_cash: 70,
      by_method: { CASH: { count: 1, total: 20 }, CARD: { count: 1, total: 30 } },
    })

    // Returning 3 of 5 units refunds 30.00: the 20.00 cash taken, then 10.00 back to the card
    const first = await request(app).post(`/api/sales/${sale.id}/refund`).set(auth(manager))
      .send({ items: [{ sale_item_id: sale.items[0].id, quantity: 3 }] })
    expect(first.status).toBe(200)
    expect(first.body.data.refunds[0]).toMatchObject({ method: 'SPLIT', amount: '30', cash_amount: '20' })

    // The rest goes back to the card; no cash is left to give
    const rest = await request(app).post(`/api/sales/${sale.id}/refund`).set(auth(manager)).send({})
    expect(rest.status).toBe(200)
    expect(rest.body.data.refunds[1]).toMatchObject({ amount: '20', cash_amount: '0' })

    const managerSummary = (await request(app).get('/api/shifts/current').set(auth(manager))).body.data.summary
    expect(managerSummary.cash_refunds).toBe(20)
    expect(managerSummary.expected_cash).toBe(80)
  })

  it('records the whole of a cash refund as cash', async () => {
    const sale = (await request(app).post('/api/sales').set(auth(cashier)).send({
      items: [{ product_id: product.id, quantity: 1 }], payment_method: 'CASH', amount_paid: 10,
    })).body.data
    const res = await request(app).post(`/api/sales/${sale.id}/refund`).set(auth(manager)).send({})
    expect(res.body.data.refunds[0]).toMatchObject({ method: 'CASH', amount: '10', cash_amount: '10' })
  })

  it('lists split sales by payment method', async () => {
    const res = await request(app).get('/api/sales?payment_method=SPLIT').set(auth(cashier))
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBeGreaterThan(0)
    expect(res.body.data.every((s: { payment_method: string }) => s.payment_method === 'SPLIT')).toBe(true)
  })
})
