// Shared fixtures for integration tests: throwaway users with access tokens
const request = require('supertest')
const bcrypt = require('bcrypt')
const app = require('../app')
const prisma = require('../utils/prismaClient')

const PASSWORD = 'testpass123'
let passwordHash

/**
 * Create a user with the given role and log them in.
 * @param {'ADMIN'|'MANAGER'|'CASHIER'} role
 * @param {string} prefix - Unique per test file so parallel or leftover data never collides
 * @returns {Promise<{ user: object, token: string }>}
 */
async function createUserWithToken(role, prefix) {
  passwordHash = passwordHash || (await bcrypt.hash(PASSWORD, 4))
  const username = `${prefix}_${role.toLowerCase()}`
  const user = await prisma.user.create({
    data: { username, email: `${username}@test.local`, password_hash: passwordHash, full_name: `${prefix} ${role}`, role },
  })
  const res = await request(app).post('/api/auth/login').send({ username, password: PASSWORD })
  return { user, token: res.body.data.accessToken }
}

/** Remove users created with this prefix, plus their auth log and inventory log rows. */
async function deleteTestUsers(prefix) {
  const users = await prisma.user.findMany({ where: { username: { startsWith: `${prefix}_` } }, select: { id: true } })
  const ids = users.map((u) => u.id)
  await prisma.authLog.deleteMany({ where: { user_id: { in: ids } } })
  await prisma.inventoryLog.deleteMany({ where: { user_id: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
}

module.exports = { app, prisma, request, createUserWithToken, deleteTestUsers }
