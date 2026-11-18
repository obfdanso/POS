require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const crypto = require('crypto')
const { app, prisma, request, createUserWithToken, deleteTestUsers } = require('./helpers')

const PREFIX = 'offlinetest'
const TEST_SETTINGS = { tax_rate: '0', require_open_shift: 'false' }
let cashier, other, category, product, originalSettings
const auth = (who) => ({ Authorization: `Bearer ${who.token}` })
const sell = (who, client_ref) => request(app).post('/api/sales').set(auth(who))
  .send({ items: [{ product_id: product.id, quantity: 1 }], payment_method: 'CASH', amount_paid: 10, client_ref })

beforeAll(async () => {
  originalSettings = await prisma.settings.findMany({ where: { key: { in: Object.keys(TEST_SETTINGS) } } })
  for (const [key, value] of Object.entries(TEST_SETTINGS)) {
    await prisma.settings.upsert({ where: { key }, update: { value }, create: { key, value } })
  }
  cashier = await createUserWithToken('CASHIER', PREFIX)
  other = await createUserWithToken('CASHIER', `${PREFIX}2`)
  category = await prisma.category.create({ data: { name: 'OfflineTest Category' } })
  product = await prisma.product.create({ data: { name: 'OfflineTest Item', sku: 'OFFLINETEST-1', category_id: category.id, price: 10, quantity: 100 } })
})

afterAll(async () => {
  const userIds = (await prisma.user.findMany({ where: { username: { startsWith: PREFIX } }, select: { id: true } })).map((u) => u.id)
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

describe('Resending a sale with client_ref', () => {
  it('records it once, however many times or however fast it is sent', async () => {
    const ref = crypto.randomUUID()
    const [a, b] = await Promise.all([sell(cashier, ref), sell(cashier, ref)])
    const c = await sell(cashier, ref)
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201])
    expect(new Set([a.body.data.id, b.body.data.id, c.body.data.id]).size).toBe(1)
    expect(await prisma.sale.count({ where: { client_ref: ref } })).toBe(1)
    expect((await prisma.product.findUnique({ where: { id: product.id } })).quantity).toBe(99)
  })

  it("won't hand one cashier another cashier's sale, and rejects a bad reference", async () => {
    const ref = crypto.randomUUID()
    expect((await sell(cashier, ref)).status).toBe(201)
    expect((await sell(other, ref)).status).toBe(409)
    expect((await sell(cashier, 'not-a-uuid')).status).toBe(422)
  })
})
