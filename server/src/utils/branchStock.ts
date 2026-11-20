import type { InventoryChangeType, InventoryLog, Prisma, PrismaClient } from '@prisma/client'
import prisma from './prismaClient'
import { ValidationError } from './errors'

const rowKey = (branchId: string, productId: string) => ({ branch_id_product_id: { branch_id: branchId, product_id: productId } })

export interface ChangeStockArgs {
  branchId: string
  productId: string
  change: number
  type: InventoryChangeType
  userId: string
  notes?: string | null
  createIfMissing?: boolean
  createdAt?: Date
}

/**
 * Change how many of a product a branch holds, and log it. This is the only place that writes
 * BranchStock.quantity, so every stock change is logged against its branch.
 *
 * The update is relative and guarded (`quantity >= -change`), so concurrent sales can't oversell.
 * Without `createIfMissing`, a branch that doesn't stock the product is refused; with it (returns,
 * deliveries, starting stock) the branch starts stocking it.
 */
export async function changeStock(
  tx: Prisma.TransactionClient,
  { branchId, productId, change, type, userId, notes, createIfMissing = false }: ChangeStockArgs
): Promise<{ previous: number; quantity: number; log: InventoryLog }> {
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
  // The row was just updated, so it exists
  const { quantity } = await tx.branchStock.findUniqueOrThrow({ where: rowKey(branchId, productId), select: { quantity: true } })
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

export interface StockLevel {
  quantity: number
  low_stock_threshold: number
}

export type StockMap = Map<string, StockLevel>

/**
 * Stock of these products at a branch, as a Map of productId → { quantity, low_stock_threshold }.
 * With no branch (an admin viewing all branches) both are summed across branches. Products a
 * branch doesn't stock are missing from the map.
 */
export async function branchStockFor(
  productIds: string[],
  branchId: string | null | undefined,
  db: PrismaClient | Prisma.TransactionClient = prisma
): Promise<StockMap> {
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

/** Anything with an id whose stock can be looked up: a product, optionally with its variants. */
export interface StockTarget {
  id: string
  variants?: StockTarget[] | null
}

interface StockFields {
  quantity: number
  low_stock_threshold: number
  stocked: boolean
}

type StockedVariants<V> = V extends (infer I)[] ? WithStock<I>[] : V

/** A product (and its variants, when loaded) with the stock fields `withStock` adds. */
export type WithStock<T> = Omit<T, keyof StockFields | 'variants'> &
  StockFields &
  ('variants' extends keyof T ? { variants: StockedVariants<T['variants' & keyof T]> } : unknown)

/**
 * Give a product (and its variants, if loaded) the `quantity` and `low_stock_threshold` of the
 * acting branch (or all branches), plus `stocked`: whether that branch carries it.
 */
export function withStock<T extends StockTarget>(product: T, stock: StockMap): WithStock<T>
export function withStock<T extends StockTarget>(product: T | null | undefined, stock: StockMap): WithStock<T> | null | undefined
export function withStock<T extends StockTarget>(product: T | null | undefined, stock: StockMap): WithStock<T> | null | undefined {
  if (!product) return product
  const own = stock.get(product.id)
  // The spread builds exactly the shape WithStock<T> describes
  return {
    ...product,
    quantity: own?.quantity ?? 0,
    low_stock_threshold: own?.low_stock_threshold ?? 0,
    stocked: Boolean(own),
    ...(Array.isArray(product.variants) && { variants: product.variants.map((v) => withStock(v, stock)) }),
  } as WithStock<T>
}
