require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })

jest.mock('../utils/sms', () => {
  const actual = jest.requireActual('../utils/sms')
  return { ...actual, isSmsConfigured: jest.fn(() => true), sendSms: jest.fn(async () => {}) }
})
const sms = require('../utils/sms')
const { app, prisma, request, createUserWithToken, deleteTestUsers } = require('./helpers')
const { buildReceiptSms } = require('../utils/receiptSms')

const PREFIX = 'smstest'
const TEST_SETTINGS = { tax_rate: '0', require_open_shift: 'false', loyalty_points_rate: '10' }
let cashier, otherCashier, category, product, customer, sale, walkInSale, originalSettings

const auth = (who) => ({ Authorization: `Bearer ${who.token}` })
const textReceipt = (id, body = {}, who = cashier) => request(app).post(`/api/sales/${id}/sms-receipt`).set(auth(who)).send(body)

beforeAll(async () => {
  originalSettings = await prisma.settings.findMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const [key, value] of Object.entries(TEST_SETTINGS)) {
    await prisma.settings.upsert({ where: { key }, update: { value }, create: { key, value } })
  }
  cashier = await createUserWithToken('CASHIER', PREFIX)
  otherCashier = await createUserWithToken('CASHIER', `${PREFIX}2`)
  category = await prisma.category.create({ data: { name: 'SmsTest Category' } })
  product = await prisma.product.create({
    data: { name: 'SmsTest Soap', sku: 'SMSTEST-SOAP', category_id: category.id, price: 12.5, quantity: 50 },
  })
  customer = await prisma.customer.create({ data: { name: 'SmsTest Customer', phone: '024-555-0199' } })
  const sell = (body) => request(app).post('/api/sales').set(auth(cashier)).send({ items: [{ product_id: product.id, quantity: 2 }], payment_method: 'CASH', amount_paid: 30, ...body })
  sale = (await sell({ customer_id: customer.id })).body.data
  walkInSale = (await sell({})).body.data
})

afterAll(async () => {
  const userIds = (await prisma.user.findMany({ where: { username: { startsWith: PREFIX } }, select: { id: true } })).map((u) => u.id)
  await prisma.auditLog.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.inventoryLog.deleteMany({ where: { product_id: product.id } })
  await prisma.sale.deleteMany({ where: { user_id: { in: userIds } } })
  await prisma.product.deleteMany({ where: { id: product.id } })
  await prisma.category.deleteMany({ where: { id: category.id } })
  await prisma.customer.deleteMany({ where: { id: customer.id } })
  await deleteTestUsers(PREFIX)
  await deleteTestUsers(`${PREFIX}2`)
  await prisma.settings.deleteMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const { key, value } of originalSettings) await prisma.settings.create({ data: { key, value } })
  await prisma.$disconnect()
})

afterEach(() => {
  sms.sendSms.mockClear()
  sms.isSmsConfigured.mockReturnValue(true)
})

describe('POST /api/sales/:id/sms-receipt', () => {
  it("texts the receipt to the customer's number on file and records it", async () => {
    const res = await textReceipt(sale.id)
    expect(res.status).toBe(200)
    expect(res.body.data.to).toBe('+233245550199')
    expect(sms.sendSms).toHaveBeenCalledTimes(1)
    const [to, message] = sms.sendSms.mock.calls[0]
    expect(to).toBe('+233245550199')
    expect(message).toContain(sale.transaction_id)
    expect(message).toContain('Total GHS 25.00')
    expect(message).toContain('Points earned: 2')
    expect(message).not.toContain('₵')

    const audit = await prisma.auditLog.findFirst({ where: { entity_id: sale.id, action: 'RECEIPT_TEXTED' } })
    expect(audit.details).toContain('+233245550199')
  })

  it('texts a number typed at the till', async () => {
    const res = await textReceipt(walkInSale.id, { phone: '020 111 2233' })
    expect(res.status).toBe(200)
    expect(sms.sendSms.mock.calls[0][0]).toBe('+233201112233')
  })

  it('only texts other countries when they are allowed', async () => {
    const blocked = await textReceipt(walkInSale.id, { phone: '+44 7700 900123' })
    expect(blocked.status).toBe(422)
    expect(blocked.body.error.details[0].message).toMatch(/local numbers/)
    expect(sms.sendSms).not.toHaveBeenCalled()

    process.env.SMS_ALLOWED_COUNTRY_CODES = '233, 44'
    try {
      const res = await textReceipt(walkInSale.id, { phone: '+44 7700 900123' })
      expect(res.status).toBe(200)
      expect(sms.sendSms.mock.calls[0][0]).toBe('+447700900123')
    } finally {
      delete process.env.SMS_ALLOWED_COUNTRY_CODES
    }
  })

  it('texts one receipt at most 3 times', async () => {
    // walkInSale has been texted twice by the tests above
    expect((await textReceipt(walkInSale.id, { phone: '0201112233' })).status).toBe(200)
    const res = await textReceipt(walkInSale.id, { phone: '0201112233' })
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('SMS_LIMIT')
  })

  it('asks for a number for a walk-in sale, and rejects one that is not a phone number', async () => {
    const none = await textReceipt(walkInSale.id)
    expect(none.status).toBe(422)
    expect(none.body.error.details[0].field).toBe('phone')

    for (const phone of ['024-555', 'call me', '0245550199999']) {
      const res = await textReceipt(walkInSale.id, { phone })
      expect(res.status).toBe(422)
    }
    expect(sms.sendSms).not.toHaveBeenCalled()
  })

  it("stops cashiers texting other cashiers' receipts", async () => {
    const res = await textReceipt(sale.id, {}, otherCashier)
    expect(res.status).toBe(403)
    expect(sms.sendSms).not.toHaveBeenCalled()
  })

  it('says when SMS is not set up', async () => {
    sms.isSmsConfigured.mockReturnValue(false)
    const res = await textReceipt(sale.id)
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('SMS_NOT_CONFIGURED')
  })

  it('reports a provider failure without leaking its details', async () => {
    sms.sendSms.mockRejectedValueOnce(new Error('Arkesel rejected the message (HTTP 401: Invalid API key)'))
    const res = await textReceipt(sale.id)
    expect(res.status).toBe(502)
    expect(res.body.error.code).toBe('SMS_FAILED')
    expect(JSON.stringify(res.body)).not.toContain('API key')
  })

  it('rejects unexpected fields', async () => {
    expect((await textReceipt(sale.id, { phone: '0245550199', message: 'hi' })).status).toBe(422)
  })
})

describe('buildReceiptSms', () => {
  it('lists each part of a split payment and the change', () => {
    const text = buildReceiptSms(
      {
        transaction_id: 'TXN-1', created_at: new Date(), total_amount: 50, discount_amount: 5, payment_method: 'SPLIT',
        sale_items: [{ quantity: 1 }],
        payments: [{ method: 'CASH', amount_paid: 40, change_given: 10 }, { method: 'MOBILE_MONEY', amount_paid: 20, change_given: 0 }],
      },
      { name: 'Shop', currency: 'GH₵' }
    )
    expect(text).toContain('1 item. Total GHS 50.00')
    expect(text).toContain('You saved GHS 5.00')
    expect(text).toContain('Paid: Cash GHS 40.00 + Mobile Money GHS 20.00, change GHS 10.00')
    expect(text.length).toBeLessThanOrEqual(320)
  })
})

describe('normalizePhone', () => {
  const { normalizePhone } = jest.requireActual('../utils/sms')
  it('turns local Ghanaian numbers into international form', () => {
    expect(normalizePhone('024-123-4567')).toBe('+233241234567')
    expect(normalizePhone('(024) 123 4567')).toBe('+233241234567')
    expect(normalizePhone('233241234567')).toBe('+233241234567')
    expect(normalizePhone('00233241234567')).toBe('+233241234567')
    expect(normalizePhone('241234567')).toBe('+233241234567')
  })
  it('rejects things that are not phone numbers', () => {
    for (const bad of ['', '12345', 'abc', '+2332412345678', '024-123-456']) expect(normalizePhone(bad)).toBeNull()
  })
})

describe('sendSms', () => {
  const real = jest.requireActual('../utils/sms')
  const saved = { ...process.env }
  let fetchMock

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch')
  })
  afterEach(() => {
    fetchMock.mockRestore()
    for (const key of ['SMS_PROVIDER', 'ARKESEL_API_KEY', 'SMS_SENDER_ID', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM']) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  it('is off until a provider and its keys are set', () => {
    delete process.env.SMS_PROVIDER
    expect(real.isSmsConfigured()).toBe(false)
    process.env.SMS_PROVIDER = 'arkesel'
    process.env.ARKESEL_API_KEY = 'key'
    delete process.env.SMS_SENDER_ID
    expect(real.isSmsConfigured()).toBe(false)
    process.env.SMS_SENDER_ID = 'QuickMart'
    expect(real.isSmsConfigured()).toBe(true)
  })

  it('sends through Arkesel with the API key header', async () => {
    Object.assign(process.env, { SMS_PROVIDER: 'arkesel', ARKESEL_API_KEY: 'ark-key', SMS_SENDER_ID: 'QuickMart' })
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success' }), { status: 200 }))
    await real.sendSms('+233241234567', 'Hello')
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://sms.arkesel.com/api/v2/sms/send')
    expect(options.headers['api-key']).toBe('ark-key')
    expect(JSON.parse(options.body)).toEqual({ sender: 'QuickMart', message: 'Hello', recipients: ['233241234567'] })

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'error', message: 'Insufficient balance' }), { status: 200 }))
    await expect(real.sendSms('+233241234567', 'Hello')).rejects.toThrow(/Insufficient balance/)
  })

  it('sends through Twilio with basic auth', async () => {
    Object.assign(process.env, { SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+15005550006' })
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 201 }))
    await real.sendSms('+233241234567', 'Hello')
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json')
    expect(options.headers.Authorization).toBe(`Basic ${Buffer.from('AC123:tok').toString('base64')}`)
    expect(Object.fromEntries(new URLSearchParams(options.body))).toEqual({ To: '+233241234567', From: '+15005550006', Body: 'Hello' })

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Invalid To' }), { status: 400 }))
    await expect(real.sendSms('+233241234567', 'Hello')).rejects.toThrow(/HTTP 400: Invalid To/)
  })
})
