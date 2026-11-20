require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { prisma, createTestProduct } = require('./helpers')

afterAll(() => prisma.$disconnect())

describe('Branch stock after the upgrade', () => {
  it('every product has at least one stock row', async () => {
    const unstocked = await prisma.product.count({ where: { stocks: { none: {} } } })
    expect(unstocked).toBe(0)
  })

  it("stock can't go negative in the database", async () => {
    // Its own row, so this also works on an empty (unseeded) database
    const category = await prisma.category.create({ data: { name: 'MigrationTest Category' } })
    const product = await createTestProduct({ name: 'MigrationTest Item', sku: 'MIGRATIONTEST-1', category_id: category.id, price: 1 }, { quantity: 1 })
    try {
      const row = await prisma.branchStock.findFirst({ where: { product_id: product.id } })
      await expect(prisma.branchStock.update({ where: { id: row.id }, data: { quantity: -1 } })).rejects.toThrow()
    } finally {
      await prisma.product.delete({ where: { id: product.id } })
      await prisma.category.delete({ where: { id: category.id } })
    }
  })

  it('non-admin users all have a branch', async () => {
    const homeless = await prisma.user.count({ where: { role: { not: 'ADMIN' }, branch_id: null } })
    expect(homeless).toBe(0)
  })
})
