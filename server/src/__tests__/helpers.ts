// Shared fixtures for integration tests: throwaway users with access tokens
import request from 'supertest'
import bcrypt from 'bcrypt'
import type { Branch, Prisma, Role, User } from '@prisma/client'
import app from '../app'
import prisma from '../utils/prismaClient'

const PASSWORD = 'testpass123'
let passwordHash: string | undefined

let defaultBranch: Branch | undefined

/** Headers that sign a test request in as a user, acting on their branch. */
export interface AuthHeaders {
  Authorization: string
  'X-Branch-Id': string
  [header: string]: string
}

/** A throwaway signed-in user from `createUserWithToken`. */
export interface TestAccount {
  user: User
  token: string
  headers: AuthHeaders
}

/** The shared branch test users and products belong to unless a test picks another. */
export async function testBranch(): Promise<Branch> {
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
 * @param prefix - Unique per test file so parallel or leftover data never collides
 */
export async function createUserWithToken(role: Role, prefix: string, { branchId }: { branchId?: string } = {}): Promise<TestAccount> {
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
  const token: string = res.body.data.accessToken
  return { user, token, headers: { Authorization: `Bearer ${token}`, 'X-Branch-Id': branch_id } }
}

/** Create a product stocked at a branch (default: the test branch). */
export async function createTestProduct(
  data: Omit<Prisma.ProductUncheckedCreateInput, 'stocks'>,
  { quantity = 0, low_stock_threshold = 10, branchId }: { quantity?: number; low_stock_threshold?: number; branchId?: string } = {}
) {
  const branch_id = branchId ?? (await testBranch()).id
  return prisma.product.create({
    data: { ...data, stocks: { create: { branch_id, quantity, low_stock_threshold } } },
  })
}

/**
 * Nested-create value for a product's `stocks`: stock at the test branch. Lets fixtures that call
 * prisma.product.create directly say `stocks: inTestBranch(20)`.
 */
export function inTestBranch(quantity = 0, low_stock_threshold = 10) {
  return {
    create: {
      quantity,
      low_stock_threshold,
      branch: { connectOrCreate: { where: { code: 'TEST' }, create: { name: 'Test Branch', code: 'TEST' } } },
    },
  } satisfies Prisma.BranchStockCreateNestedManyWithoutProductInput
}

/** How many of a product a branch (default: the test branch) holds, or null when it doesn't stock it. */
export async function stockAt(productId: string, branchId?: string): Promise<number | null> {
  const branch_id = branchId ?? (await testBranch()).id
  const row = await prisma.branchStock.findUnique({ where: { branch_id_product_id: { branch_id, product_id: productId } } })
  return row ? row.quantity : null
}

/** Remove users created with this prefix, plus their auth log and inventory log rows. */
export async function deleteTestUsers(prefix: string): Promise<void> {
  const users = await prisma.user.findMany({ where: { username: { startsWith: `${prefix}_` } }, select: { id: true } })
  const ids = users.map((u) => u.id)
  await prisma.authLog.deleteMany({ where: { user_id: { in: ids } } })
  await prisma.inventoryLog.deleteMany({ where: { user_id: { in: ids } } })
  await prisma.shift.deleteMany({ where: { user_id: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
}

export { app, prisma, request }
