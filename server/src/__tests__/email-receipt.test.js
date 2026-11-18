require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })

jest.mock('../utils/mailer', () => ({ isEmailConfigured: jest.fn(() => true), sendMail: jest.fn(async () => ({})) }))
const mailer = require('../utils/mailer')
const { app, prisma, request, createUserWithToken, deleteTestUsers } = require('./helpers')
const { buildReceiptEmail } = require('../utils/receiptEmail')

const PREFIX = 'mailtest'
const TEST_SETTINGS = { tax_rate: '0', require_open_shift: 'false' }
let cashier, otherCashier, category, product, customer, sale, walkInSale, originalSettings

const auth = (who) => ({ Authorization: `Bearer ${who.token}` })
const emailReceipt = (id, body = {}, who = cashier) => request(app).post(`/api/sales/${id}/email-receipt`).set(auth(who)).send(body)

beforeAll(async () => {
  originalSettings = await prisma.settings.findMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const [key, value] of Object.entries(TEST_SETTINGS)) {
    await prisma.settings.upsert({ where: { key }, update: { value }, create: { key, value } })
  }
  cashier = await createUserWithToken('CASHIER', PREFIX)
  otherCashier = await createUserWithToken('CASHIER', `${PREFIX}2`)
  category = await prisma.category.create({ data: { name: 'MailTest Category' } })
  product = await prisma.product.create({
    data: { name: 'MailTest <b>Bold</b> Soap', sku: 'MAILTEST-SOAP', category_id: category.id, price: 12.5, quantity: 50 },
  })
  customer = await prisma.customer.create({ data: { name: 'MailTest Customer', email: 'mailtest.customer@example.com' } })
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

beforeEach(() => {
  mailer.sendMail.mockClear()
  mailer.isEmailConfigured.mockReturnValue(true)
})

describe('POST /api/sales/:id/email-receipt', () => {
  it("sends the receipt to the customer's email on file and records it", async () => {
    const res = await emailReceipt(sale.id)
    expect(res.status).toBe(200)
    expect(res.body.data.to).toBe('mailtest.customer@example.com')
    expect(mailer.sendMail).toHaveBeenCalledTimes(1)
    const message = mailer.sendMail.mock.calls[0][0]
    expect(message.to).toBe('mailtest.customer@example.com')
    expect(message.subject).toContain(sale.transaction_id)
    expect(message.html).toContain('25.00')
    expect(await prisma.auditLog.count({ where: { action: 'RECEIPT_EMAILED', entity_id: sale.id } })).toBe(1)
  })

  it('sends to an address typed at the till instead', async () => {
    const res = await emailReceipt(walkInSale.id, { email: 'walk.in@example.com' })
    expect(res.status).toBe(200)
    expect(mailer.sendMail.mock.calls[0][0].to).toBe('walk.in@example.com')
  })

  it('needs an address when the sale has no customer email, and a valid one', async () => {
    const missing = await emailReceipt(walkInSale.id)
    expect(missing.status).toBe(422)
    expect(missing.body.error.details[0].field).toBe('email')
    expect((await emailReceipt(sale.id, { email: 'not-an-email' })).status).toBe(422)
    expect((await emailReceipt(sale.id, { email: 'a@example.com', cc: 'b@example.com' })).status).toBe(422)
    expect(mailer.sendMail).not.toHaveBeenCalled()
  })

  it("stops cashiers emailing another cashier's sale", async () => {
    expect((await emailReceipt(sale.id, {}, otherCashier)).status).toBe(403)
    expect(mailer.sendMail).not.toHaveBeenCalled()
  })

  it('answers 503 when email is not set up', async () => {
    mailer.isEmailConfigured.mockReturnValue(false)
    const res = await emailReceipt(sale.id)
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('EMAIL_NOT_CONFIGURED')
  })

  it('answers 502 when the mail server refuses the message', async () => {
    mailer.sendMail.mockRejectedValueOnce(new Error('550 mailbox unavailable'))
    const res = await emailReceipt(sale.id)
    expect(res.status).toBe(502)
    expect(res.body.error.code).toBe('EMAIL_FAILED')
  })
})

describe('buildReceiptEmail', () => {
  it('escapes product and store names', async () => {
    const full = await prisma.sale.findUnique({
      where: { id: sale.id },
      include: { sale_items: { include: { product: true } }, payments: true, user: true, customer: true },
    })
    const { html, text } = buildReceiptEmail(full, { name: 'Shop & <Co>', currency: 'GH₵' })
    expect(html).toContain('MailTest &lt;b&gt;Bold&lt;/b&gt; Soap')
    expect(html).toContain('Shop &amp; &lt;Co&gt;')
    expect(html).not.toContain('<b>Bold</b>')
    expect(text).toContain('2 × MailTest <b>Bold</b> Soap  GH₵ 25.00')
  })

  it('lists each part of a split payment and the change from the cash part', () => {
    const split = {
      transaction_id: 'TXN-SPLIT', created_at: new Date(), subtotal: 50, discount_amount: 0, tax_amount: 0, total_amount: 50,
      payment_method: 'SPLIT', sale_items: [],
      payments: [
        { method: 'CASH', amount_paid: 40, change_given: 10 },
        { method: 'MOBILE_MONEY', amount_paid: 20, change_given: 0 },
      ],
    }
    const { text } = buildReceiptEmail(split, { name: 'Shop', currency: 'GH₵' })
    expect(text).toContain('Payment: Split')
    expect(text).toContain('  Cash: GH₵ 40.00')
    expect(text).toContain('  Mobile Money: GH₵ 20.00')
    expect(text).toContain('Change: GH₵ 10.00')
    expect(text).not.toContain('Amount paid')
  })
})
