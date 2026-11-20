import './loadEnv'
import crypto from 'crypto'

jest.mock('../utils/paystack', () => {
  const actual = jest.requireActual<typeof import('../utils/paystack')>('../utils/paystack')
  return { ...actual, verifyPaystackPayment: jest.fn(), refundPaystackPayment: jest.fn(), fetchPaystackRefund: jest.fn() }
})
import * as paystack from '../utils/paystack'
import { AppError } from '../utils/errors'
import type { Category, Product, Settings } from '@prisma/client'
import { app, prisma, request, createUserWithToken, deleteTestUsers, inTestBranch, type TestAccount } from './helpers'

const PREFIX = 'gwrefund'
const TEST_SETTINGS = { tax_rate: '0', require_open_shift: 'false' }
const SECRET = 'sk_test_gateway_refunds'
let manager: TestAccount, cashier: TestAccount, category: Category, product: Product, originalSettings: Settings[]
const savedEnv = { key: process.env.PAYSTACK_SECRET_KEY, auto: process.env.PAYSTACK_AUTO_REFUND }

const auth = (who: TestAccount) => who.headers
let refCounter = 0
const ref = () => `GW-REF-${Date.now()}-${++refCounter}`
const paystackOk = (amountGhs: number) =>
  jest.mocked(paystack.verifyPaystackPayment).mockResolvedValueOnce({ status: true, data: { status: 'success', amount: Math.round(amountGhs * 100), currency: 'GHS' } })
const queued = (id: number, status = 'pending') => jest.mocked(paystack.refundPaystackPayment).mockResolvedValueOnce({ status: true, message: 'Refund has been queued for processing', data: { id, status } })

/** The fields of a sale from the API that these tests reuse. */
interface SaleBody {
  id: string
  transaction_id: string
  items: { id: string }[]
}

// A card sale of `quantity` units at 10.00 each
async function cardSale(quantity = 2): Promise<{ sale: SaleBody; reference: string }> {
  const reference = ref()
  paystackOk(quantity * 10)
  const res = await request(app).post('/api/sales').set(auth(cashier))
    .send({ items: [{ product_id: product.id, quantity }], payment_method: 'CARD', amount_paid: quantity * 10, reference })
  expect(res.status).toBe(201)
  return { sale: res.body.data, reference }
}
const returnOne = (sale: SaleBody) => request(app).post(`/api/sales/${sale.id}/refund`).set(auth(manager))
  .send({ items: [{ sale_item_id: sale.items[0].id, quantity: 1 }] })
const sendToPaystack = (saleId: string, refundId: string, who: TestAccount = manager) =>
  request(app).post(`/api/sales/${saleId}/refunds/${refundId}/paystack`).set(auth(who)).send({})

beforeAll(async () => {
  originalSettings = await prisma.settings.findMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const [key, value] of Object.entries(TEST_SETTINGS)) {
    await prisma.settings.upsert({ where: { key }, update: { value }, create: { key, value } })
  }
  manager = await createUserWithToken('MANAGER', PREFIX)
  cashier = await createUserWithToken('CASHIER', `${PREFIX}2`)
  category = await prisma.category.create({ data: { name: 'GwRefund Category' } })
  product = await prisma.product.create({ data: { name: 'GwRefund Item', sku: 'GWREFUND-1', category_id: category.id, price: 10, stocks: inTestBranch(500) } })
})

afterAll(async () => {
  const userIds = (await prisma.user.findMany({ where: { username: { startsWith: PREFIX } }, select: { id: true } })).map((u) => u.id)
  await prisma.auditLog.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.inventoryLog.deleteMany({ where: { product_id: product.id } })
  await prisma.sale.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.product.deleteMany({ where: { id: product.id } })
  await prisma.category.deleteMany({ where: { id: category.id } })
  await deleteTestUsers(PREFIX)
  await deleteTestUsers(`${PREFIX}2`)
  await prisma.settings.deleteMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const { key, value } of originalSettings) await prisma.settings.create({ data: { key, value } })
  await prisma.$disconnect()
})

beforeEach(() => {
  process.env.PAYSTACK_SECRET_KEY = SECRET
  delete process.env.PAYSTACK_AUTO_REFUND
  jest.mocked(paystack.refundPaystackPayment).mockReset()
  jest.mocked(paystack.fetchPaystackRefund).mockReset()
})

afterEach(() => {
  if (savedEnv.key === undefined) delete process.env.PAYSTACK_SECRET_KEY
  else process.env.PAYSTACK_SECRET_KEY = savedEnv.key
  if (savedEnv.auto === undefined) delete process.env.PAYSTACK_AUTO_REFUND
  else process.env.PAYSTACK_AUTO_REFUND = savedEnv.auto
})

describe('Refunds through Paystack', () => {
  it('sends the card part of a return back to the charge it came from', async () => {
    const { sale, reference } = await cardSale()
    queued(9001)
    const res = await returnOne(sale)
    expect(res.status).toBe(200)
    expect(paystack.refundPaystackPayment).toHaveBeenCalledWith(reference, 1000, `Return for ${sale.transaction_id}`)
    expect(res.body.data.refunds[0]).toMatchObject({
      amount: '10', cash_amount: '0', gateway_amount: '10', gateway_reference: reference, gateway_status: 'PENDING', gateway_refund_id: '9001',
    })
  })

  it('keeps the return when Paystack refuses, and lets a manager try again', async () => {
    const { sale } = await cardSale()
    jest.mocked(paystack.refundPaystackPayment).mockResolvedValueOnce({ status: false, message: 'Transaction has been fully reversed' })
    const res = await returnOne(sale)
    expect(res.status).toBe(200)
    const refund = res.body.data.refunds[0]
    expect(refund).toMatchObject({ gateway_status: 'FAILED', gateway_error: 'Transaction has been fully reversed' })
    expect(res.body.data.payment_status).toBe('PARTIALLY_REFUNDED')

    queued(9002, 'processed')
    const retry = await sendToPaystack(sale.id, refund.id)
    expect(retry.status).toBe(200)
    expect(retry.body.data.refunds[0]).toMatchObject({ gateway_status: 'PROCESSED', gateway_refund_id: '9002', gateway_error: null })
  })

  it('says to check the dashboard when Paystack could not be reached', async () => {
    const { sale } = await cardSale()
    jest.mocked(paystack.refundPaystackPayment).mockRejectedValueOnce(new AppError('Payment gateway timed out', 503))
    const res = await returnOne(sale)
    expect(res.body.data.refunds[0].gateway_status).toBe('FAILED')
    expect(res.body.data.refunds[0].gateway_error).toMatch(/timed out.*Check the Paystack dashboard/)
  })

  it('sends only the non-cash part of a split sale refund', async () => {
    const cardRef = ref()
    paystackOk(30)
    const sale = (await request(app).post('/api/sales').set(auth(cashier)).send({
      items: [{ product_id: product.id, quantity: 5 }], payment_method: 'SPLIT',
      payments: [{ method: 'CASH', amount: 25 }, { method: 'CARD', amount: 30, reference: cardRef }],
    })).body.data
    queued(9003)
    const res = await request(app).post(`/api/sales/${sale.id}/refund`).set(auth(manager)).send({})
    expect(res.body.data.refunds[0]).toMatchObject({ amount: '50', cash_amount: '20', gateway_amount: '30', gateway_reference: cardRef })
    expect(paystack.refundPaystackPayment).toHaveBeenCalledWith(cardRef, 3000, expect.any(String))
  })

  it('records but does not send when automatic refunds are off, until a manager sends it', async () => {
    process.env.PAYSTACK_AUTO_REFUND = 'false'
    const { sale } = await cardSale()
    const res = await returnOne(sale)
    const refund = res.body.data.refunds[0]
    expect(refund.gateway_status).toBe('NOT_SENT')
    expect(paystack.refundPaystackPayment).not.toHaveBeenCalled()

    expect((await sendToPaystack(sale.id, refund.id, cashier)).status).toBe(403)
    queued(9004)
    const sent = await sendToPaystack(sale.id, refund.id)
    expect(sent.body.data.refunds[0].gateway_status).toBe('PENDING')
    // Sending again only checks on it
    jest.mocked(paystack.fetchPaystackRefund).mockResolvedValueOnce({ status: true, data: { id: 9004, status: 'processing' } })
    const checked = await sendToPaystack(sale.id, refund.id)
    expect(paystack.fetchPaystackRefund).toHaveBeenCalledWith('9004')
    expect(paystack.refundPaystackPayment).toHaveBeenCalledTimes(1)
    expect(checked.body.data.refunds[0].gateway_status).toBe('PROCESSING')
  })

  it('has nothing to send for cash refunds, and needs Paystack set up', async () => {
    const sale = (await request(app).post('/api/sales').set(auth(cashier))
      .send({ items: [{ product_id: product.id, quantity: 1 }], payment_method: 'CASH', amount_paid: 10 })).body.data
    const res = await request(app).post(`/api/sales/${sale.id}/refund`).set(auth(manager)).send({})
    const refund = res.body.data.refunds[0]
    expect(refund.gateway_status).toBeNull()
    expect((await sendToPaystack(sale.id, refund.id)).status).toBe(422)

    delete process.env.PAYSTACK_SECRET_KEY
    const { sale: card } = await cardSale()
    const cardRefund = (await returnOne(card)).body.data.refunds[0]
    expect(cardRefund.gateway_status).toBe('NOT_SENT')
    expect((await sendToPaystack(card.id, cardRefund.id)).status).toBe(503)
  })

  it('lets a send that was cut off be retried after a while', async () => {
    process.env.PAYSTACK_AUTO_REFUND = 'false'
    const { sale } = await cardSale()
    const refund = (await returnOne(sale)).body.data.refunds[0]
    // As if the server stopped right after claiming it
    await prisma.$executeRaw`UPDATE "Refund" SET gateway_status = 'PENDING', updated_at = NOW() - INTERVAL '10 minutes' WHERE id = ${refund.id}`
    const res = await sendToPaystack(sale.id, refund.id)
    expect(res.status).toBe(200)
    expect(res.body.data.refunds[0]).toMatchObject({ gateway_status: 'FAILED', gateway_error: expect.stringMatching(/interrupted/) })
    expect(paystack.refundPaystackPayment).not.toHaveBeenCalled()

    queued(9006)
    expect((await sendToPaystack(sale.id, refund.id)).body.data.refunds[0].gateway_status).toBe('PENDING')
  })

  it('only sends a refund once when two requests race', async () => {
    process.env.PAYSTACK_AUTO_REFUND = 'false'
    const { sale } = await cardSale()
    const refund = (await returnOne(sale)).body.data.refunds[0]
    jest.mocked(paystack.refundPaystackPayment).mockImplementation(async () => ({ status: true, data: { id: 9005, status: 'pending' } }))
    jest.mocked(paystack.fetchPaystackRefund).mockImplementation(async () => ({ status: true, data: { id: 9005, status: 'pending' } }))
    const results = await Promise.all([sendToPaystack(sale.id, refund.id), sendToPaystack(sale.id, refund.id)])
    // The second either finds it being sent (409) or, once sent, just checks on it (200)
    expect(results.map((r) => r.status)).toContain(200)
    expect(results.every((r) => [200, 409].includes(r.status))).toBe(true)
    expect(paystack.refundPaystackPayment).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/paystack/webhook', () => {
  const post = (body: object, secret = SECRET) => {
    const raw = JSON.stringify(body)
    const signature = crypto.createHmac('sha512', secret).update(raw).digest('hex')
    return request(app).post('/api/paystack/webhook').set('Content-Type', 'application/json').set('x-paystack-signature', signature).send(raw)
  }

  it('updates a sent refund, and never moves a processed one back', async () => {
    const { sale } = await cardSale()
    queued(9100)
    const refund = (await returnOne(sale)).body.data.refunds[0]

    const done = await post({ event: 'refund.processed', data: { id: 9100, status: 'processed' } })
    expect(done.status).toBe(200)
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).gateway_status).toBe('PROCESSED')

    await post({ event: 'refund.pending', data: { id: 9100, status: 'pending' } })
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).gateway_status).toBe('PROCESSED')
  })

  it('matches events without an id by charge reference and amount, and never hides a failure', async () => {
    const { sale, reference } = await cardSale()
    jest.mocked(paystack.refundPaystackPayment).mockResolvedValueOnce({ status: true, data: { status: 'pending' } })
    const refund = (await returnOne(sale)).body.data.refunds[0]
    expect(refund).toMatchObject({ gateway_status: 'PENDING', gateway_refund_id: null })

    await post({ event: 'refund.failed', data: { transaction_reference: reference, amount: 1000, status: 'failed' } })
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).gateway_status).toBe('FAILED')
    // A late "processing" must not cover up the failure
    await post({ event: 'refund.processing', data: { transaction_reference: reference, amount: 1000 } })
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).gateway_status).toBe('FAILED')
  })

  it('rejects events without a valid signature', async () => {
    expect((await post({ event: 'refund.processed', data: { id: 1 } }, 'wrong-secret')).status).toBe(401)
    const unsigned = await request(app).post('/api/paystack/webhook').send({ event: 'refund.processed', data: { id: 1 } })
    expect(unsigned.status).toBe(401)
  })

  it('accepts other events without changing anything', async () => {
    expect((await post({ event: 'charge.success', data: { id: 1 } })).status).toBe(200)
  })
})
