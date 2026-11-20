import { Prisma, type InventoryChangeType } from '@prisma/client'
import prisma from '../utils/prismaClient'
import { changeStock } from '../utils/branchStock'
import { buildOrderBy, type SortDirection } from '../middleware/sorting'
import { NotFoundError, ValidationError } from '../utils/errors'

type StockOrderBy = Prisma.BranchStockOrderByWithRelationInput

export const INVENTORY_SORTS: Record<string, (dir: SortDirection) => StockOrderBy | StockOrderBy[]> = {
  name: (dir) => ({ product: { name: dir } }),
  category: (dir) => [{ product: { category: { name: dir } } }, { product: { name: 'asc' } }],
  quantity: (dir) => ({ quantity: dir }),
  low_stock_threshold: (dir) => ({ low_stock_threshold: dir }),
  price: (dir) => ({ product: { price: dir } }),
  branch: (dir) => [{ branch: { name: dir } }, { product: { name: 'asc' } }],
}

/**
 * Stock rows (one per branch per product) for active products: the acting branch's, or every
 * branch's when an admin views all branches. Each row reads like a product with its stock, plus
 * the branch it belongs to.
 */
export interface ListInventoryOptions {
  page?: number
  per_page?: number
  search?: string
  status?: string
  sort?: string
  order?: string
  branchId?: string | null
}

export async function listInventory({ page = 1, per_page = 20, search, status, sort, order, branchId = null }: ListInventoryOptions = {}) {
  const skip = (page - 1) * per_page
  const take = Math.min(per_page, 100)

  const productWhere: Prisma.ProductWhereInput = { is_active: true }
  const where: Prisma.BranchStockWhereInput = { product: productWhere, ...(branchId && { branch_id: branchId }) }
  if (search) {
    productWhere.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
    ]
  }
  if (status === 'out') {
    where.quantity = 0
  }

  const [rows, total] = await Promise.all([
    prisma.branchStock.findMany({
      where,
      skip,
      take,
      select: {
        branch_id: true,
        quantity: true,
        low_stock_threshold: true,
        updated_at: true,
        branch: { select: { id: true, name: true, code: true } },
        product: { select: { id: true, name: true, sku: true, price: true, category: { select: { id: true, name: true } } } },
      },
      orderBy: buildOrderBy<StockOrderBy>({ sort, order }, INVENTORY_SORTS, { product: { name: 'asc' } }),
    }),
    prisma.branchStock.count({ where }),
  ])

  const products = rows.map(({ product, ...stock }) => ({ ...product, ...stock }))
  return { products, total, page, per_page: take, total_pages: Math.ceil(total / take) }
}

const branchFilter = (branchId: string | null | undefined) => (branchId ? Prisma.sql`AND s.branch_id = ${branchId}` : Prisma.empty)

export async function getLowStockCount(branchId: string | null = null): Promise<number> {
  const result = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int as count
    FROM "BranchStock" s
    JOIN "Product" p ON p.id = s.product_id
    WHERE p.is_active = true AND s.quantity <= s.low_stock_threshold ${branchFilter(branchId)}
  `
  return Number(result[0].count)
}

/** Stock rows at or below their low-stock level, for the acting branch (or all branches). */
/** A row of the low-stock query. */
interface LowStockRow {
  id: string
  name: string
  sku: string
  quantity: number
  low_stock_threshold: number
  price: Prisma.Decimal
  branch_id: string
  category: { id: string; name: string }
  branch: { id: string; name: string; code: string }
}

export async function getLowStock(branchId: string | null = null) {
  const rows = await prisma.$queryRaw<LowStockRow[]>`
    SELECT p.id, p.name, p.sku, s.quantity, s.low_stock_threshold, p.price, s.branch_id,
           json_build_object('id', c.id, 'name', c.name) as category,
           json_build_object('id', b.id, 'name', b.name, 'code', b.code) as branch
    FROM "BranchStock" s
    JOIN "Product" p ON p.id = s.product_id
    JOIN "Category" c ON c.id = p.category_id
    JOIN "Branch" b ON b.id = s.branch_id
    WHERE p.is_active = true AND s.quantity <= s.low_stock_threshold ${branchFilter(branchId)}
    ORDER BY s.quantity ASC, p.name ASC
  `
  return rows.map((r) => ({
    ...r,
    quantity: Number(r.quantity),
    low_stock_threshold: Number(r.low_stock_threshold),
  }))
}

/** Add or remove stock at a branch by hand. Refuses to go below zero. */
export async function adjustStock(
  productId: string,
  quantityChange: number,
  changeType: InventoryChangeType,
  userId: string,
  notes: string | null | undefined,
  branchId: string
) {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } })
  if (!product) throw new NotFoundError('Product not found')

  return prisma.$transaction(async (tx) => {
    let result
    try {
      result = await changeStock(tx, { branchId, productId, change: quantityChange, type: changeType, userId, notes })
    } catch (err) {
      // Name the field the form sent
      if (err instanceof ValidationError && err.details?.[0]?.field === 'quantity') {
        throw new ValidationError('Adjustment would result in negative stock', [
          { field: 'quantity_change', message: err.details[0].message },
        ])
      }
      throw err
    }
    // changeStock just updated this row, so it exists
    const stock = await tx.branchStock.findUniqueOrThrow({
      where: { branch_id_product_id: { branch_id: branchId, product_id: productId } },
      include: { product: true },
    })
    return { product: { ...stock.product, quantity: stock.quantity, low_stock_threshold: stock.low_stock_threshold }, log: result.log }
  })
}

/** Goods arriving at a branch; a branch that didn't stock the product starts stocking it. */
export async function restockProduct(productId: string, quantity: number, userId: string, notes: string | null | undefined, branchId: string) {
  if (quantity <= 0) {
    throw new ValidationError('Restock quantity must be positive', [
      { field: 'quantity', message: 'Must be greater than 0' },
    ])
  }
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } })
  if (!product) throw new NotFoundError('Product not found')
  return prisma.$transaction(async (tx) => {
    const { log, quantity: newQty } = await changeStock(tx, {
      branchId, productId, change: quantity, type: 'RESTOCK', userId, notes, createIfMissing: true,
    })
    // Checked above, so it exists
    const full = await tx.product.findUniqueOrThrow({ where: { id: productId } })
    return { product: { ...full, quantity: newQty }, log }
  })
}

/** A product's stock history at the acting branch (every branch's when none is chosen). */
export async function getInventoryLog(
  productId: string,
  { page = 1, per_page = 20, branchId = null }: { page?: number; per_page?: number; branchId?: string | null } = {}
) {
  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product) throw new NotFoundError('Product not found')

  const skip = (page - 1) * per_page
  const take = Math.min(per_page, 100)

  const [logs, total] = await Promise.all([
    prisma.inventoryLog.findMany({
      where: { product_id: productId, ...(branchId && { branch_id: branchId }) },
      skip,
      take,
      orderBy: { created_at: 'desc' },
      include: {
        user: { select: { id: true, username: true, full_name: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
    }),
    prisma.inventoryLog.count({ where: { product_id: productId, ...(branchId && { branch_id: branchId }) } }),
  ])

  return { logs, total, page, per_page: take, total_pages: Math.ceil(total / take) }
}

