const prisma = require('./prismaClient')
const { ValidationError } = require('./errors')

const rowKey = (branchId, productId) => ({ branch_id_product_id: { branch_id: branchId, product_id: productId } })

/**
 * Change how many of a product a branch holds, and log it. This is the only place that writes
 * BranchStock.quantity, so every stock change is logged against its branch.
 *
 * The update is relative and guarded (`quantity >= -change`), so concurrent sales can't oversell.
 * Without `createIfMissing`, a branch that doesn't stock the product is refused; with it (returns,
 * deliveries, starting stock) the branch starts stocking it.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ branchId: string, productId: string, change: number, type: string, userId: string,
 *   notes?: string|null, createIfMissing?: boolean, createdAt?: Date }} args
 * @returns {Promise<{ previous: number, quantity: number, log: object }>}
 */
async function changeStock(tx, { branchId, productId, change, type, userId, notes, createIfMissing = false }) {
  if (createIfMissing) {
    await tx.branchStock.upsert({
      where: rowKey(branchId, productId),
      create: { branch_id: branchId, product_id: productId },
      update: {},
    })
  }
  const { count } = await tx.branchStock.updateMany({
    where: { branch_id: branchId, product_id: productId, ...(change < 0 && { quantity: { gte: -change } }) },
    data: { quantity: { increment: change } },
  })
  if (count === 0) {
    const row = await tx.branchStock.findUnique({ where: rowKey(branchId, productId), select: { quantity: true } })
    if (!row) {
      const product = await tx.product.findUnique({ where: { id: productId }, select: { name: true } })
      throw new ValidationError('Not stocked at this branch', [
        { field: 'items', message: `"${product?.name ?? 'This product'}" is not stocked at this branch` },
      ])
    }
    throw new ValidationError('Not enough stock', [
      { field: 'quantity', message: `Cannot reduce below 0. Current stock: ${row.quantity}` },
    ])
  }
  const { quantity } = await tx.branchStock.findUnique({ where: rowKey(branchId, productId), select: { quantity: true } })
  const log = await tx.inventoryLog.create({
    data: {
      product_id: productId,
      branch_id: branchId,
      change_type: type,
      quantity_change: change,
      previous_quantity: quantity - change,
      new_quantity: quantity,
      user_id: userId,
      notes: notes || null,
    },
  })
  return { previous: quantity - change, quantity, log }
}

/**
 * Stock of these products at a branch, as a Map of productId → { quantity, low_stock_threshold }.
 * With no branch (an admin viewing all branches) both are summed across branches. Products a
 * branch doesn't stock are missing from the map.
 */
async function branchStockFor(productIds, branchId, db = prisma) {
  const ids = [...new Set(productIds)]
  if (ids.length === 0) return new Map()
  if (branchId) {
    const rows = await db.branchStock.findMany({
      where: { branch_id: branchId, product_id: { in: ids } },
      select: { product_id: true, quantity: true, low_stock_threshold: true },
    })
    return new Map(rows.map((r) => [r.product_id, { quantity: r.quantity, low_stock_threshold: r.low_stock_threshold }]))
  }
  const sums = await db.branchStock.groupBy({
    by: ['product_id'],
    where: { product_id: { in: ids } },
    _sum: { quantity: true, low_stock_threshold: true },
  })
  return new Map(sums.map((r) => [r.product_id, { quantity: r._sum.quantity ?? 0, low_stock_threshold: r._sum.low_stock_threshold ?? 0 }]))
}

/**
 * Give a product (and its variants, if loaded) the `quantity` and `low_stock_threshold` of the
 * acting branch (or all branches), plus `stocked`: whether that branch carries it.
 */
function withStock(product, stock) {
  if (!product) return product
  const own = stock.get(product.id)
  return {
    ...product,
    quantity: own?.quantity ?? 0,
    low_stock_threshold: own?.low_stock_threshold ?? 0,
    stocked: Boolean(own),
    ...(Array.isArray(product.variants) && { variants: product.variants.map((v) => withStock(v, stock)) }),
  }
}

module.exports = { changeStock, branchStockFor, withStock }
