require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { app, prisma, request, createUserWithToken, deleteTestUsers, testBranch } = require('./helpers')

const PREFIX = 'usertest'
let admin, manager, cashier, originalSettings, branch

beforeAll(async () => {
  [admin, manager, cashier] = await Promise.all([
    createUserWithToken('ADMIN', PREFIX),
    createUserWithToken('MANAGER', PREFIX),
    createUserWithToken('CASHIER', PREFIX),
  ])
  originalSettings = await prisma.settings.findMany()
  branch = await testBranch()
})

afterAll(async () => {
  // Put the store's settings back exactly as they were
  await prisma.settings.deleteMany()
  await prisma.settings.createMany({ data: originalSettings.map(({ key, value }) => ({ key, value })) })
  await deleteTestUsers(PREFIX)
  await prisma.$disconnect()
})

const auth = (who) => ({ Authorization: `Bearer ${who.token}` })
const login = (username, password) => request(app).post('/api/auth/login').send({ username, password })

describe('User management (admin only)', () => {
  let createdId

  it('blocks managers and cashiers', async () => {
    expect((await request(app).get('/api/users').set(auth(manager))).status).toBe(403)
    expect((await request(app).get('/api/users').set(auth(cashier))).status).toBe(403)
  })

  it('creates a user who can then log in', async () => {
    const res = await request(app).post('/api/users').set(auth(admin))
      .send({ username: `${PREFIX}_new`, email: `${PREFIX}_new@test.local`, password: 'secret12', full_name: 'New Person', role: 'CASHIER', branch_id: branch.id })
    expect(res.status).toBe(201)
    expect(res.body.data.branch).toMatchObject({ id: branch.id, code: 'TEST' })
    expect(res.body.data).not.toHaveProperty('password_hash')
    createdId = res.body.data.id
    expect((await login(`${PREFIX}_new`, 'secret12')).status).toBe(200)
  })

  it('rejects usernames that differ only by case, and duplicate emails', async () => {
    const username = await request(app).post('/api/users').set(auth(admin))
      .send({ username: `${PREFIX}_NEW`, email: `${PREFIX}_other@test.local`, password: 'secret12', full_name: 'X', role: 'CASHIER' })
    expect(username.status).toBe(409)
    expect(username.body.error.details[0].field).toBe('username')

    const email = await request(app).post('/api/users').set(auth(admin))
      .send({ username: `${PREFIX}_other`, email: `${PREFIX}_new@test.local`, password: 'secret12', full_name: 'X', role: 'CASHIER' })
    expect(email.body.error.details[0].field).toBe('email')
  })

  it('validates new users', async () => {
    const res = await request(app).post('/api/users').set(auth(admin)).send({ username: '', email: 'x', password: '123', role: 'BOSS' })
    expect(res.status).toBe(422)
    expect(res.body.error.details.map((d) => d.field)).toEqual(expect.arrayContaining(['username', 'email', 'password', 'full_name', 'role']))
  })

  it('updates another user, and deactivated users cannot log in', async () => {
    const res = await request(app).put(`/api/users/${createdId}`).set(auth(admin)).send({ role: 'MANAGER', is_active: false })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ role: 'MANAGER', is_active: false })
    expect((await login(`${PREFIX}_new`, 'secret12')).status).toBe(401)
  })

  it('requires a branch for cashiers and managers, and never gives admins one', async () => {
    const missing = await request(app).post('/api/users').set(auth(admin))
      .send({ username: `${PREFIX}_nobranch`, email: `${PREFIX}_nobranch@test.local`, password: 'secret12', full_name: 'X', role: 'MANAGER' })
    expect(missing.status).toBe(422)
    expect(missing.body.error.details[0].field).toBe('branch_id')

    const boss = await request(app).post('/api/users').set(auth(admin))
      .send({ username: `${PREFIX}_boss`, email: `${PREFIX}_boss@test.local`, password: 'secret12', full_name: 'X', role: 'ADMIN', branch_id: branch.id })
    expect(boss.status).toBe(201)
    expect(boss.body.data.branch).toBeNull()

    // Promoting someone to admin takes them off their branch; demoting needs a branch again
    const demote = await request(app).put(`/api/users/${boss.body.data.id}`).set(auth(admin)).send({ role: 'CASHIER' })
    expect(demote.status).toBe(422)
    expect(demote.body.error.details[0].field).toBe('branch_id')
  })

  it('lets an admin edit or deactivate staff of a closed branch without moving them', async () => {
    const shut = await prisma.branch.create({ data: { name: 'UserTest Shut', code: 'UTS', is_active: false } })
    const worker = await prisma.user.create({
      data: { username: `${PREFIX}_shutworker`, email: `${PREFIX}_shutworker@test.local`, password_hash: 'x', full_name: 'Old Name', role: 'CASHIER', branch_id: shut.id },
    })
    try {
      const res = await request(app).put(`/api/users/${worker.id}`).set(auth(admin)).send({ full_name: 'New Name', is_active: false })
      expect(res.status).toBe(200)
      expect(res.body.data).toMatchObject({ full_name: 'New Name', is_active: false })
      // Moving someone to a closed branch is still refused
      const move = await request(app).put(`/api/users/${cashier.user.id}`).set(auth(admin)).send({ branch_id: shut.id })
      expect(move.status).toBe(422)
    } finally {
      await prisma.auditLog.deleteMany({ where: { entity_id: worker.id } })
      await prisma.user.delete({ where: { id: worker.id } })
      await prisma.branch.delete({ where: { id: shut.id } })
    }
  })

  it("can't move someone to another branch while their shift is open", async () => {
    const other = await prisma.branch.upsert({ where: { code: 'UTB' }, update: {}, create: { name: 'UserTest Branch', code: 'UTB' } })
    const shift = await prisma.shift.create({ data: { user_id: cashier.user.id, opening_float: 0, branch_id: branch.id } })
    try {
      const res = await request(app).put(`/api/users/${cashier.user.id}`).set(auth(admin)).send({ branch_id: other.id })
      expect(res.status).toBe(422)
      expect(res.body.error.details[0].field).toBe('branch_id')
    } finally {
      await prisma.shift.delete({ where: { id: shift.id } })
    }
    const moved = await request(app).put(`/api/users/${cashier.user.id}`).set(auth(admin)).send({ branch_id: other.id })
    expect(moved.status).toBe(200)
    expect(moved.body.data.branch.code).toBe('UTB')
    await request(app).put(`/api/users/${cashier.user.id}`).set(auth(admin)).send({ branch_id: branch.id })
  })

  it('stops admins removing their own admin access', async () => {
    const demote = await request(app).put(`/api/users/${admin.user.id}`).set(auth(admin)).send({ role: 'CASHIER' })
    expect(demote.status).toBe(422)
    const deactivate = await request(app).put(`/api/users/${admin.user.id}`).set(auth(admin)).send({ is_active: false })
    expect(deactivate.status).toBe(422)
  })

  it('lists users with a lock flag, and unlocking is logged', async () => {
    await prisma.user.update({ where: { id: cashier.user.id }, data: { failed_login_attempts: 5, locked_until: new Date('9999-12-31') } })
    const list = await request(app).get('/api/users').set(auth(admin))
    expect(list.body.data.find((u) => u.id === cashier.user.id).is_locked).toBe(true)
    expect(list.body.data[0]).not.toHaveProperty('password_hash')

    const unlock = await request(app).post(`/api/users/${cashier.user.id}/unlock`).set(auth(admin))
    expect(unlock.status).toBe(200)
    const log = await prisma.authLog.findFirst({ where: { user_id: cashier.user.id, event_type: 'ACCOUNT_UNLOCKED' } })
    expect(log.details).toContain(`${PREFIX}_admin`)
  })

  it('resets a password, which also unlocks the account', async () => {
    await prisma.user.update({ where: { id: createdId }, data: { is_active: true, locked_until: new Date('9999-12-31') } })
    const res = await request(app).post(`/api/users/${createdId}/reset-password`).set(auth(admin)).send({ password: 'brandnew1' })
    expect(res.status).toBe(200)
    expect((await login(`${PREFIX}_new`, 'brandnew1')).status).toBe(200)
  })

  it('returns 404 for unknown users', async () => {
    const missing = '00000000-0000-0000-0000-000000000000'
    expect((await request(app).put(`/api/users/${missing}`).set(auth(admin)).send({ full_name: 'X' })).status).toBe(404)
    expect((await request(app).post(`/api/users/${missing}/unlock`).set(auth(admin))).status).toBe(404)
    expect((await request(app).post(`/api/users/${missing}/reset-password`).set(auth(admin)).send({ password: 'whatever1' })).status).toBe(404)
  })

  it('gives managers a names-only staff list', async () => {
    const res = await request(app).get('/api/users/staff').set(auth(manager))
    expect(res.status).toBe(200)
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['full_name', 'id', 'role'])
    expect((await request(app).get('/api/users/staff').set(auth(cashier))).status).toBe(403)
  })
})

describe('Own profile and password', () => {
  it('updates the signed-in user profile', async () => {
    const res = await request(app).put('/api/auth/profile').set(auth(manager)).send({ full_name: 'Renamed Manager' })
    expect(res.status).toBe(200)
    expect(res.body.data.full_name).toBe('Renamed Manager')
    const me = await request(app).get('/api/auth/me').set(auth(manager))
    expect(me.body.data.full_name).toBe('Renamed Manager')
  })

  it('cannot change role through the profile endpoint', async () => {
    const res = await request(app).put('/api/auth/profile').set(auth(cashier)).send({ role: 'ADMIN' })
    expect(res.status).toBe(422)
  })

  it('changes password only with the correct current password', async () => {
    const wrong = await request(app).post('/api/auth/change-password').set(auth(manager))
      .send({ current_password: 'wrong', new_password: 'newpass123' })
    expect(wrong.status).toBe(422)
    expect(wrong.body.error.details[0].field).toBe('current_password')

    const ok = await request(app).post('/api/auth/change-password').set(auth(manager))
      .send({ current_password: 'testpass123', new_password: 'newpass123' })
    expect(ok.status).toBe(200)
    expect((await login(`${PREFIX}_manager`, 'newpass123')).status).toBe(200)
    // Older sessions are signed out; carry on with the fresh token the endpoint returned
    expect((await request(app).get('/api/auth/me').set(auth(manager))).status).toBe(401)
    manager.token = ok.body.data.accessToken
  })
})

describe('Settings', () => {
  it('returns defaults merged with saved values to any role', async () => {
    const res = await request(app).get('/api/settings').set(auth(cashier))
    expect(res.status).toBe(200)
    expect(Object.keys(res.body.data)).toEqual(expect.arrayContaining(['store_name', 'tax_rate', 'currency_symbol', 'receipt_footer']))
  })

  it('lets admins save settings', async () => {
    const res = await request(app).put('/api/settings').set(auth(admin)).send({ store_name: 'Test Store', tax_rate: '5' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ store_name: 'Test Store', tax_rate: '5' })
  })

  it('validates values and rejects unknown keys', async () => {
    expect((await request(app).put('/api/settings').set(auth(admin)).send({ tax_rate: '150' })).status).toBe(422)
    expect((await request(app).put('/api/settings').set(auth(admin)).send({ currency_symbol: '' })).status).toBe(422)
    expect((await request(app).put('/api/settings').set(auth(admin)).send({ admin_password: 'x' })).status).toBe(422)
  })

  it('is admin only', async () => {
    expect((await request(app).put('/api/settings').set(auth(manager)).send({ store_name: 'Nope' })).status).toBe(403)
  })
})
