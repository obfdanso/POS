require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { app, prisma, request, createUserWithToken, deleteTestUsers } = require('./helpers')

const PREFIX = 'branchtest'
const CODES = ['BTA', 'BTB', 'BTC', 'BTX', 'BTS', 'BTE']
let admin, manager, cashier, branchA

beforeAll(async () => {
  await prisma.branch.deleteMany({ where: { code: { in: CODES } } })
  branchA = await prisma.branch.create({ data: { name: 'BranchTest A', code: 'BTA' } })
  admin = await createUserWithToken('ADMIN', PREFIX)
  manager = await createUserWithToken('MANAGER', PREFIX, { branchId: branchA.id })
  cashier = await createUserWithToken('CASHIER', PREFIX, { branchId: branchA.id })
})

afterAll(async () => {
  const ids = (await prisma.user.findMany({ where: { username: { startsWith: PREFIX } }, select: { id: true } })).map((u) => u.id)
  await prisma.auditLog.deleteMany({ where: { user_id: { in: ids } } })
  await deleteTestUsers(PREFIX)
  await deleteTestUsers(`${PREFIX}c`)
  await prisma.branch.deleteMany({ where: { code: { in: CODES } } })
  await prisma.$disconnect()
})

describe('Branches API', () => {
  it('admin creates, edits and deactivates a branch', async () => {
    const created = await request(app).post('/api/branches').set(admin.headers).send({ name: 'BranchTest C', code: 'BTC', phone: '030-000-0000' })
    expect(created.status).toBe(201)
    expect(created.body.data).toMatchObject({ name: 'BranchTest C', code: 'BTC', is_active: true })

    const duplicate = await request(app).post('/api/branches').set(admin.headers).send({ name: 'Another', code: 'BTC' })
    expect(duplicate.status).toBe(409)

    const badCode = await request(app).post('/api/branches').set(admin.headers).send({ name: 'Bad code', code: 'k1' })
    expect(badCode.status).toBe(422)
    expect(badCode.body.error.details[0].field).toBe('code')

    const closed = await request(app).put(`/api/branches/${created.body.data.id}`).set(admin.headers).send({ is_active: false })
    expect(closed.status).toBe(200)
    expect(closed.body.data.is_active).toBe(false)
  })

  it("managers and cashiers can't manage branches, but can list the open ones", async () => {
    const res = await request(app).post('/api/branches').set(manager.headers).send({ name: 'Nope', code: 'NOPE' })
    expect(res.status).toBe(403)

    const list = await request(app).get('/api/branches?active=true').set(cashier.headers)
    expect(list.status).toBe(200)
    const mine = list.body.data.find((b) => b.id === branchA.id)
    expect(Object.keys(mine).sort()).toEqual(['code', 'id', 'name'])
    expect(list.body.data.every((b) => b.code !== 'BTC')).toBe(true)
  })

  it('rejects an admin header naming a branch that does not exist', async () => {
    const res = await request(app).get('/api/branches').set({ ...admin.headers, 'X-Branch-Id': '00000000-0000-4000-8000-000000000000' })
    expect(res.status).toBe(422)
    expect(res.body.error.details[0].field).toBe('branch')
  })

  it("lets an admin read a closed branch's history but not change it", async () => {
    const shop = await prisma.branch.create({ data: { name: 'BranchTest Shut', code: 'BTS', is_active: false } })
    CODES.push('BTS')
    const asShop = { ...admin.headers, 'X-Branch-Id': shop.id }
    expect((await request(app).get('/api/branches').set(asShop)).status).toBe(200)
    const write = await request(app).post('/api/branches').set(asShop).send({ name: 'BranchTest Z', code: 'BTZ' })
    expect(write.status).toBe(422)
    expect(write.body.error.details[0].message).toBe('That branch is closed')
  })

  it('staff of a closed branch are signed out and cannot log in', async () => {
    const shop = await prisma.branch.create({ data: { name: 'BranchTest Closing', code: 'BTX' } })
    CODES.push('BTX')
    const worker = await createUserWithToken('CASHIER', `${PREFIX}c`, { branchId: shop.id })
    expect((await request(app).get('/api/auth/me').set(worker.headers)).status).toBe(200)

    await request(app).put(`/api/branches/${shop.id}`).set(admin.headers).send({ is_active: false })

    expect((await request(app).get('/api/auth/me').set(worker.headers)).status).toBe(401)
    const login = await request(app).post('/api/auth/login').send({ username: worker.user.username, password: 'testpass123' })
    expect(login.status).toBe(401)
  })

  it('refuses a cashier who has no branch instead of showing them every branch', async () => {
    const worker = await createUserWithToken('CASHIER', `${PREFIX}n`)
    await prisma.user.update({ where: { id: worker.user.id }, data: { branch_id: null } })
    const res = await request(app).get('/api/branches').set({ Authorization: worker.headers.Authorization })
    expect(res.status).toBe(403)
    expect(res.body.error.message).toBe('You are not assigned to a branch. Ask an admin.')
    const login = await request(app).post('/api/auth/login').send({ username: worker.user.username, password: 'testpass123' })
    expect(login.status).toBe(401)
    await deleteTestUsers(`${PREFIX}n`)
  })

  it('tells staff which branch they work at', async () => {
    const me = await request(app).get('/api/auth/me').set(cashier.headers)
    expect(me.body.data.branch).toMatchObject({ id: branchA.id, name: 'BranchTest A', code: 'BTA' })
  })

  it("staff can't act on another branch by sending its id in the header", async () => {
    const elsewhere = await prisma.branch.create({ data: { name: 'BranchTest Elsewhere', code: 'BTE' } })
    CODES.push('BTE')
    const res = await request(app).get('/api/inventory').set({ ...cashier.headers, 'X-Branch-Id': elsewhere.id })
    expect(res.status).toBe(200)
    expect(res.body.data.every((row) => row.branch_id === branchA.id)).toBe(true)
  })

  it('admin needs to choose a branch before changing stock', async () => {
    const res = await request(app).post('/api/inventory/restock')
      .set({ Authorization: admin.headers.Authorization })
      .send({ product_id: '00000000-0000-4000-8000-000000000000', quantity: 1 })
    expect(res.status).toBe(422)
    expect(res.body.error.details[0]).toMatchObject({ field: 'branch', message: 'Choose a branch first' })
  })
})


describe('Selling and returning across branches', () => {
  let branchB, managerB, cashierB, item, unstocked, originalShiftSetting
  const sell = (who, body, headers = who.headers) => request(app).post('/api/sales').set(headers).send({ payment_method: 'CASH', amount_paid: 1000, ...body })

  beforeAll(async () => {
    originalShiftSetting = await prisma.settings.findUnique({ where: { key: 'require_open_shift' } })
    await prisma.settings.upsert({ where: { key: 'require_open_shift' }, update: { value: 'false' }, create: { key: 'require_open_shift', value: 'false' } })
    branchB = await prisma.branch.create({ data: { name: 'BranchTest B', code: 'BTB' } })
    managerB = await createUserWithToken('MANAGER', `${PREFIX}b`, { branchId: branchB.id })
    cashierB = await createUserWithToken('CASHIER', `${PREFIX}b`, { branchId: branchB.id })
    const category = await prisma.category.upsert({ where: { name: 'BranchTest Category' }, update: {}, create: { name: 'BranchTest Category' } })
    item = await prisma.product.create({
      data: {
        name: 'BranchTest Soap', sku: 'BRANCHTEST-1', category_id: category.id, price: 5,
        stocks: { create: [{ branch_id: branchA.id, quantity: 3 }, { branch_id: branchB.id, quantity: 3 }] },
      },
    })
    unstocked = await prisma.product.create({
      data: { name: 'BranchTest Kettle', sku: 'BRANCHTEST-2', category_id: category.id, price: 50, stocks: { create: { branch_id: branchB.id, quantity: 2 } } },
    })
  })

  afterAll(async () => {
    const ids = [item.id, unstocked.id]
    await prisma.sale.deleteMany({ where: { sale_items: { some: { product_id: { in: ids } } } } })
    await prisma.inventoryLog.deleteMany({ where: { product_id: { in: ids } } })
    await prisma.branchStock.deleteMany({ where: { product_id: { in: ids } } })
    await prisma.product.deleteMany({ where: { id: { in: ids } } })
    await prisma.category.deleteMany({ where: { name: 'BranchTest Category' } })
    await prisma.shift.deleteMany({ where: { user_id: admin.user.id } })
    await deleteTestUsers(`${PREFIX}b`)
    if (originalShiftSetting) await prisma.settings.update({ where: { key: 'require_open_shift' }, data: { value: originalShiftSetting.value } })
  })

  const stock = async (branch, product = item) =>
    (await prisma.branchStock.findUnique({ where: { branch_id_product_id: { branch_id: branch.id, product_id: product.id } } }))?.quantity

  it("sells from the branch's own stock only", async () => {
    const res = await sell(cashier, { items: [{ product_id: item.id, quantity: 3 }] })
    expect(res.status).toBe(201)
    expect(res.body.data.branch_id).toBe(branchA.id)
    expect(await stock(branchA)).toBe(0)
    expect(await stock(branchB)).toBe(3)

    const more = await sell(cashier, { items: [{ product_id: item.id, quantity: 1 }] })
    expect(more.status).toBe(422)
    const log = await prisma.inventoryLog.findFirst({ where: { product_id: item.id, change_type: 'SALE' } })
    expect(log.branch_id).toBe(branchA.id)
  })

  it('refuses a product the branch does not stock', async () => {
    const res = await sell(cashier, { items: [{ product_id: unstocked.id, quantity: 1 }] })
    expect(res.status).toBe(422)
    expect(res.body.error.details[0]).toMatchObject({ field: 'items', message: '"BranchTest Kettle" is not stocked at this branch' })
  })

  it('puts goods returned at another branch into that branch\'s stock', async () => {
    const sale = (await sell(cashierB, { items: [{ product_id: unstocked.id, quantity: 1 }] })).body.data
    expect(await stock(branchB, unstocked)).toBe(1)

    // Branch A's manager can't browse branch B's sales, but finds this one by its transaction ID
    expect((await request(app).get(`/api/sales/${sale.id}`).set(manager.headers)).status).toBe(404)
    const found = await request(app).get(`/api/sales/lookup/${sale.transaction_id}`).set(manager.headers)
    expect(found.status).toBe(200)
    expect(found.body.data).toMatchObject({ id: sale.id, branch: { code: 'BTB' } })

    const back = await request(app).post(`/api/sales/${sale.id}/refund`).set(manager.headers).send({ reason: 'Bought in B, returned in A' })
    expect(back.status).toBe(200)
    expect(await stock(branchA, unstocked)).toBe(1)
    expect(await stock(branchB, unstocked)).toBe(1)
    const refund = await prisma.refund.findFirst({ where: { sale_id: sale.id } })
    expect(refund.branch_id).toBe(branchA.id)
    // Having handled the return, A's manager can open the sale again (e.g. to reprint the slip)
    expect((await request(app).get(`/api/sales/${sale.id}`).set(manager.headers)).status).toBe(200)
  })

  it("shows only what a return needs when looking up another branch's sale, and records the lookup", async () => {
    const customer = await prisma.customer.create({ data: { name: 'BranchTest Buyer', phone: '020-555-0101', email: 'buyer@branchtest.local' } })
    try {
      const sale = (await sell(cashierB, { items: [{ product_id: item.id, quantity: 1 }], customer_id: customer.id })).body.data
      const res = await request(app).get(`/api/sales/lookup/${sale.transaction_id}`).set(manager.headers)
      expect(res.status).toBe(200)
      expect(res.body.data.customer).toEqual({ id: customer.id, name: 'BranchTest Buyer' })
      expect(res.body.data.payments.every((p) => !('reference' in p))).toBe(true)
      const audit = await prisma.auditLog.findFirst({ where: { action: 'SALE_LOOKUP', entity_id: sale.id, user_id: manager.user.id } })
      expect(audit).not.toBeNull()
    } finally {
      await prisma.sale.updateMany({ where: { customer_id: customer.id }, data: { customer_id: null } })
      await prisma.customer.delete({ where: { id: customer.id } })
    }
  })

  it("keeps another branch's manager away from a sale's Paystack refunds", async () => {
    const sale = (await sell(cashierB, { items: [{ product_id: item.id, quantity: 1 }] })).body.data
    await request(app).post(`/api/sales/${sale.id}/refund`).set(managerB.headers).send({})
    const refund = await prisma.refund.findFirst({ where: { sale_id: sale.id } })
    const res = await request(app).post(`/api/sales/${sale.id}/refunds/${refund.id}/paystack`).set(manager.headers).send({})
    expect(res.status).toBe(404)
  })

  it("lists only the branch's sales to its manager", async () => {
    const res = await request(app).get('/api/sales?per_page=100').set(managerB.headers)
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBeGreaterThan(0)
    expect(res.body.data.every((s) => s.branch_id === branchB.id)).toBe(true)
  })

  it("doesn't let cashiers look sales up by transaction ID", async () => {
    expect((await request(app).get('/api/sales/lookup/TXN-20260101-0001').set(cashier.headers)).status).toBe(403)
  })

  it("doesn't use an admin's shift at one branch for a sale at another", async () => {
    await prisma.shift.create({ data: { user_id: admin.user.id, opening_float: 0, branch_id: branchA.id } })
    const res = await sell(admin, { items: [{ product_id: item.id, quantity: 1 }] }, { ...admin.headers, 'X-Branch-Id': branchB.id })
    expect(res.status).toBe(201)
    expect(res.body.data.branch_id).toBe(branchB.id)
    expect(res.body.data.shift_id).toBeNull()
  })

  it('makes an admin choose a branch before selling', async () => {
    const res = await sell(admin, { items: [{ product_id: item.id, quantity: 1 }] }, { Authorization: admin.headers.Authorization })
    expect(res.status).toBe(422)
    expect(res.body.error.details[0].field).toBe('branch')
  })
})
