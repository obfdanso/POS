require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { app, prisma, request, createUserWithToken, deleteTestUsers } = require('./helpers')

const PREFIX = 'branchtest'
const CODES = ['BTA', 'BTB', 'BTC']
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

  it('tells staff which branch they work at', async () => {
    const me = await request(app).get('/api/auth/me').set(cashier.headers)
    expect(me.body.data.branch).toMatchObject({ id: branchA.id, name: 'BranchTest A', code: 'BTA' })
  })

  it.todo("staff can't act on another branch by sending its id in the header")
  it.todo('admin needs to choose a branch before changing stock')
})
