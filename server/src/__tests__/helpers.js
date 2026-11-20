// Shared fixtures for integration tests: throwaway users with access tokens
const request = require('supertest')
const bcrypt = require('bcrypt')
const app = require('../app')
const prisma = require('../utils/prismaClient')

const PASSWORD = 'testpass123'
let passwordHash

let defaultBranch

/** The shared branch test users and products belong to unless a test picks another. */
async function testBranch() {
  defaultBranch =
    defaultBranch ||
    (await prisma.branch.upsert({
      where: { code: 'TEST' },
      update: { is_active: true },
      create: { name: 'Test Branch', code: 'TEST' },
    }))
  return defaultBranch
}

/**
 * Create a user with the given role and log them in.
 * Cashiers and managers work at `branchId` (default: the test branch); admins have no branch.
 * `headers` carries the access token, plus the branch header so an admin acts on that branch too.
 * @param {'ADMIN'|'MANAGER'|'CASHIER'} role
 * @param {string} prefix - Unique per test file so parallel or leftover data never collides
 * @param {{ branchId?: string }} [options]
 * @returns {Promise<{ user: object, token: string, headers: object }>}
 */
async function createUserWithToken(role, prefix, { branchId } = {}) {
  passwordHash = passwordHash || (await bcrypt.hash(PASSWORD, 4))
  const branch_id = branchId ?? (await testBranch()).id
  const username = `${prefix}_${role.toLowerCase()}`
  const user = await prisma.user.create({
    data: {
      username,
      email: `${username}@test.local`,
      password_hash: passwordHash,
      full_name: `${prefix} ${role}`,
      role,
      branch_id: role === 'ADMIN' ? null : branch_id,
    },
  })
  const res = await request(app).post('/api/auth/login').send({ username, password: PASSWORD })
  const token = res.body.data.accessToken
  return { user, token, headers: { Authorization: `Bearer ${token}`, 'X-Branch-Id': branch_id } }
}

/**
 * Create a product stocked at a branch (default: the test branch).
 * @returns {Promise<object>} the product
 */
async function createTestProduct(data, { quantity = 0, low_stock_threshold = 10, branchId } = {}) {
  const branch_id = branchId ?? (await testBranch()).id
  return prisma.product.create({
    data: { ...data, stocks: { create: { branch_id, quantity, low_stock_threshold } } },
  })
}

/** How many of a product a branch (default: the test branch) holds, or null when it doesn't stock it. */
async function stockAt(productId, branchId) {
  const branch_id = branchId ?? (await testBranch()).id
  const row = await prisma.branchStock.findUnique({ where: { branch_id_product_id: { branch_id, product_id: productId } } })
  return row ? row.quantity : null
}

/** Remove users created with this prefix, plus their auth log and inventory log rows. */
async function deleteTestUsers(prefix) {
  const users = await prisma.user.findMany({ where: { username: { startsWith: `${prefix}_` } }, select: { id: true } })
  const ids = users.map((u) => u.id)
  await prisma.authLog.deleteMany({ where: { user_id: { in: ids } } })
  await prisma.inventoryLog.deleteMany({ where: { user_id: { in: ids } } })
  await prisma.shift.deleteMany({ where: { user_id: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
}

module.exports = { app, prisma, request, createUserWithToken, deleteTestUsers, testBranch, createTestProduct, stockAt }
