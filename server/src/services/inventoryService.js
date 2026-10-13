const prisma = require('../utils/prismaClient')
const { NotFoundError, ValidationError } = require('../utils/errors')

async function listInventory({ page = 1, per_page = 20, search, status } = {}) {
  const skip = (page - 1) * per_page
  const take = Math.min(per_page, 100)

  const where = { is_active: true }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
    ]
  }
  if (status === 'out') {
    where.quantity = 0
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take,
      select: {
        id: true,
        name: true,
        sku: true,
        quantity: true,
        low_stock_threshold: true,
        price: true,
        category: { select: { id: true, name: true } },
        updated_at: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.product.count({ where }),
  ])

  return { products, total, page, per_page: take, total_pages: Math.ceil(total / take) }
}

async function getLowStockCount() {
  const result = await prisma.$queryRaw`
    SELECT COUNT(*)::int as count
    FROM "Product"
    WHERE is_active = true AND quantity <= low_stock_threshold
  `
  return Number(result[0].count)
}

async function getLowStock() {
  const rows = await prisma.$queryRaw`
    SELECT p.id, p.name, p.sku, p.quantity, p.low_stock_threshold,
           json_build_object('id', c.id, 'name', c.name) as category
    FROM "Product" p
    JOIN "Category" c ON c.id = p.category_id
    WHERE p.is_active = true AND p.quantity <= p.low_stock_threshold
    ORDER BY p.quantity ASC
  `
  return rows.map((r) => ({
    ...r,
    quantity: Number(r.quantity),
    low_stock_threshold: Number(r.low_stock_threshold),
  }))
}

async function adjustStock(productId, quantityChange, changeType, userId, notes) {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } })
  if (!product) throw new NotFoundError('Product not found')

  return prisma.$transaction(async (tx) => {
    // Relative update guarded against going negative, so concurrent sales are never overwritten
    const { count } = await tx.product.updateMany({
      where: { id: productId, ...(quantityChange < 0 && { quantity: { gte: -quantityChange } }) },
      data: { quantity: { increment: quantityChange } },
    })
    if (count === 0) {
      const { quantity } = await tx.product.findUnique({ where: { id: productId }, select: { quantity: true } })
      throw new ValidationError('Adjustment would result in negative stock', [
        { field: 'quantity_change', message: `Cannot reduce below 0. Current stock: ${quantity}` },
      ])
    }

    const updatedProduct = await tx.product.findUnique({ where: { id: productId } })
    const log = await tx.inventoryLog.create({
      data: {
        product_id: productId,
        change_type: changeType,
        quantity_change: quantityChange,
        previous_quantity: updatedProduct.quantity - quantityChange,
        new_quantity: updatedProduct.quantity,
        user_id: userId,
        notes: notes || null,
      },
    })

    return { product: updatedProduct, log }
  })
}

async function restockProduct(productId, quantity, userId, notes) {
  if (quantity <= 0) {
    throw new ValidationError('Restock quantity must be positive', [
      { field: 'quantity', message: 'Must be greater than 0' },
    ])
  }
  return adjustStock(productId, quantity, 'RESTOCK', userId, notes)
}

async function getInventoryLog(productId, { page = 1, per_page = 20 } = {}) {
  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product) throw new NotFoundError('Product not found')

  const skip = (page - 1) * per_page
  const take = Math.min(per_page, 100)

  const [logs, total] = await Promise.all([
    prisma.inventoryLog.findMany({
      where: { product_id: productId },
      skip,
      take,
      orderBy: { created_at: 'desc' },
      include: {
        user: { select: { id: true, username: true, full_name: true } },
      },
    }),
    prisma.inventoryLog.count({ where: { product_id: productId } }),
  ])

  return { logs, total, page, per_page: take, total_pages: Math.ceil(total / take) }
}

module.exports = {
  listInventory,
  getLowStock,
  getLowStockCount,
  adjustStock,
  restockProduct,
  getInventoryLog,
}
