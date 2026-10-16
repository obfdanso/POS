require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { app, prisma, request, createUserWithToken, deleteTestUsers } = require('./helpers')

const PREFIX = 'usertest'
let admin, manager, cashier, originalSettings

beforeAll(async () => {
  [admin, manager, cashier] = await Promise.all([
    createUserWithToken('ADMIN', PREFIX),
    createUserWithToken('MANAGER', PREFIX),
    createUserWithToken('CASHIER', PREFIX),
  ])
  originalSettings = await prisma.settings.findMany()
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
      .send({ username: `${PREFIX}_new`, email: `${PREFIX}_new@test.local`, password: 'secret12', full_name: 'New Person', role: 'CASHIER' })
    expect(res.status).toBe(201)
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
    expect(wrong.status).toBe(401)

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
