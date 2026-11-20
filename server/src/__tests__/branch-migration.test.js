require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const prisma = require('../utils/prismaClient')

afterAll(() => prisma.$disconnect())

describe('Branch stock after the upgrade', () => {
  it('every product has at least one stock row', async () => {
    const unstocked = await prisma.product.count({ where: { stocks: { none: {} } } })
    expect(unstocked).toBe(0)
  })

  it("stock can't go negative in the database", async () => {
    const row = await prisma.branchStock.findFirst()
    await expect(prisma.branchStock.update({ where: { id: row.id }, data: { quantity: -1 } })).rejects.toThrow()
  })

  it('non-admin users all have a branch', async () => {
    const homeless = await prisma.user.count({ where: { role: { not: 'ADMIN' }, branch_id: null } })
    expect(homeless).toBe(0)
  })
})
