import { Prisma } from '@prisma/client'
import prisma from '../utils/prismaClient'
// Product/category/profit revenue is net sales: each line's share of its sale after the cart
// discount, excluding tax. Profit cost uses the cost price recorded at the time of sale.
// Returns are netted out: sale totals subtract refunded_amount and lines count only the units kept,
// so a partly refunded sale still counts, and a fully refunded one (status REFUNDED) drops out.
import { ValidationError } from '../utils/errors'
import { buildDateRange } from '../utils/dateRange'
import { getLowStockCount } from './inventoryService'

/** A date-range report's options: YYYY-MM-DD dates (defaulting to the last 30 days) and the branch, or null for all. */
export interface ReportOptions {
  start_date?: string
  end_date?: string
  branchId?: string | null
}

/** A count from a raw query (`::int`). */
interface CountRow {
  cnt: number
}

// Every report covers one branch when given one (null = every branch). `table` is the alias or
// quoted table name of the Sale (or BranchStock) row being filtered
function branchSql(table: string, branchId: string | null | undefined): Prisma.Sql {
  return branchId ? Prisma.sql`AND ${Prisma.raw(table)}.branch_id = ${branchId}` : Prisma.empty
}

// Defaults to the last 30 days (including today) when dates are omitted
function dateRange(start_date: string | undefined, end_date: string | undefined): { gte: Date; lte: Date } {
  const range = buildDateRange(start_date, end_date)
  if (!range.lte) {
    range.lte = new Date()
    range.lte.setHours(23, 59, 59, 999)
  }
  if (!range.gte) {
    range.gte = new Date(range.lte)
    range.gte.setDate(range.gte.getDate() - 29)
    range.gte.setHours(0, 0, 0, 0)
  }

  const { gte, lte } = range
  if (gte > lte) {
    throw new ValidationError('Invalid date range', [
      { field: 'start_date', message: 'start_date must be before end_date' },
    ])
  }

  return { gte, lte }
}

export async function getSalesSummary({ start_date, end_date, branchId = null }: ReportOptions) {
  const range = dateRange(start_date, end_date)
  // Tax is scaled by the share of each sale that wasn't refunded
  const [result] = await prisma.$queryRaw<{ transaction_count: number; total_revenue: number; total_discount: number; total_tax: number }[]>`
    SELECT
      COUNT(*)::int AS transaction_count,
      COALESCE(SUM(total_amount - refunded_amount), 0)::float AS total_revenue,
      COALESCE(SUM(discount_amount), 0)::float AS total_discount,
      COALESCE(ROUND(SUM(tax_amount * (total_amount - refunded_amount) / NULLIF(total_amount, 0)), 2), 0)::float AS total_tax
    FROM "Sale"
    WHERE created_at >= ${range.gte} AND created_at <= ${range.lte}
      AND payment_status IN ('COMPLETED', 'PARTIALLY_REFUNDED')
      ${branchSql('"Sale"', branchId)}
  `
  const revenue = Number(result.total_revenue || 0)
  return {
    total_revenue: revenue,
    transaction_count: result.transaction_count,
    average_sale: result.transaction_count > 0 ? Math.round((revenue / result.transaction_count) * 100) / 100 : 0,
    total_discount: Number(result.total_discount || 0),
    total_tax: Number(result.total_tax || 0),
  }
}

export async function getSalesByDay({ start_date, end_date, branchId = null }: ReportOptions) {
  const range = dateRange(start_date, end_date)
  // Every day in the range appears, with zeros for days that had no sales
  const sales = await prisma.$queryRaw<{ label: string; transactions: number; value: number }[]>`
    SELECT
      to_char(d.day, 'YYYY-MM-DD') AS label,
      COUNT(s.id)::int AS transactions,
      COALESCE(SUM(s.total_amount - s.refunded_amount), 0)::float AS value
    FROM generate_series(${range.gte}::timestamp::date, ${range.lte}::timestamp::date, interval '1 day') AS d(day)
    LEFT JOIN "Sale" s
      ON DATE(s.created_at) = d.day
      AND s.payment_status IN ('COMPLETED', 'PARTIALLY_REFUNDED')
      AND s.created_at >= ${range.gte} AND s.created_at <= ${range.lte}
      ${branchSql('s', branchId)}
    GROUP BY d.day
    ORDER BY d.day ASC
  `
  return sales.map((r) => ({ label: r.label, value: Number(r.value || 0), transactions: r.transactions }))
}

/** A product's row in the top-products query. */
interface TopProductRow {
  id: string
  name: string
  sku: string
  total_quantity: number
  total_revenue: number | null
}

export async function getTopProducts({
  start_date,
  end_date,
  limit = 10,
  by = 'revenue',
  branchId = null,
}: ReportOptions & { limit?: number; by?: string }) {
  const range = dateRange(start_date, end_date)
  const lim = parseInt(String(limit)) || 10

  let results: TopProductRow[]
  if (by === 'quantity') {
    results = await prisma.$queryRaw<TopProductRow[]>`
      SELECT p.id, p.name, p.sku,
        SUM(si.quantity - si.refunded_quantity)::int as total_quantity,
        ROUND(SUM(si.total * (si.quantity - si.refunded_quantity) / si.quantity * (s.subtotal - s.discount_amount) / NULLIF(s.subtotal, 0)), 2)::float as total_revenue
      FROM "SaleItem" si
      JOIN "Product" p ON p.id = si.product_id
      JOIN "Sale" s ON s.id = si.sale_id
      WHERE s.created_at >= ${range.gte} AND s.created_at <= ${range.lte}
        AND s.payment_status IN ('COMPLETED', 'PARTIALLY_REFUNDED')
        ${branchSql('s', branchId)}
      GROUP BY p.id, p.name, p.sku
      ORDER BY total_quantity DESC
      LIMIT ${lim}
    `
  } else {
    results = await prisma.$queryRaw<TopProductRow[]>`
      SELECT p.id, p.name, p.sku,
        SUM(si.quantity - si.refunded_quantity)::int as total_quantity,
        ROUND(SUM(si.total * (si.quantity - si.refunded_quantity) / si.quantity * (s.subtotal - s.discount_amount) / NULLIF(s.subtotal, 0)), 2)::float as total_revenue
      FROM "SaleItem" si
      JOIN "Product" p ON p.id = si.product_id
      JOIN "Sale" s ON s.id = si.sale_id
      WHERE s.created_at >= ${range.gte} AND s.created_at <= ${range.lte}
        AND s.payment_status IN ('COMPLETED', 'PARTIALLY_REFUNDED')
        ${branchSql('s', branchId)}
      GROUP BY p.id, p.name, p.sku
      ORDER BY total_revenue DESC
      LIMIT ${lim}
    `
  }
  return results.map((r) => ({
    id: r.id,
    label: r.name,
    sku: r.sku,
    value: Number(r.total_revenue || 0),
    quantity: r.total_quantity,
  }))
}

export async function getCategoryPerformance({ start_date, end_date, branchId = null }: ReportOptions) {
  const range = dateRange(start_date, end_date)
  const results = await prisma.$queryRaw<{ id: string; label: string; total_quantity: number; value: number | null }[]>`
    SELECT
      c.id,
      c.name as label,
      SUM(si.quantity - si.refunded_quantity)::int as total_quantity,
      ROUND(SUM(si.total * (si.quantity - si.refunded_quantity) / si.quantity * (s.subtotal - s.discount_amount) / NULLIF(s.subtotal, 0)), 2)::float as value
    FROM "SaleItem" si
    JOIN "Product" p ON p.id = si.product_id
    JOIN "Category" c ON c.id = p.category_id
    JOIN "Sale" s ON s.id = si.sale_id
    WHERE s.created_at >= ${range.gte} AND s.created_at <= ${range.lte}
      AND s.payment_status IN ('COMPLETED', 'PARTIALLY_REFUNDED')
      ${branchSql('s', branchId)}
    GROUP BY c.id, c.name
    ORDER BY value DESC
  `
  return results.map((r) => ({ id: r.id, label: r.label, value: Number(r.value || 0), quantity: r.total_quantity }))
}

export async function getCashierPerformance({ start_date, end_date, branchId = null }: ReportOptions) {
  const range = dateRange(start_date, end_date)
  const results = await prisma.$queryRaw<{ id: string; label: string; username: string; transactions: number; value: number | null }[]>`
    SELECT
      u.id,
      u.full_name as label,
      u.username,
      COUNT(s.id)::int as transactions,
      SUM(s.total_amount - s.refunded_amount)::float as value
    FROM "Sale" s
    JOIN "User" u ON u.id = s.user_id
    WHERE s.created_at >= ${range.gte} AND s.created_at <= ${range.lte}
      AND s.payment_status IN ('COMPLETED', 'PARTIALLY_REFUNDED')
      ${branchSql('s', branchId)}
    GROUP BY u.id, u.full_name, u.username
    ORDER BY value DESC
  `
  return results.map((r) => ({
    id: r.id,
    label: r.label,
    username: r.username,
    value: Number(r.value || 0),
    transactions: r.transactions,
  }))
}

/**
 * Stock levels at a branch (or, for all branches, every branch's stock rows, so "low at Accra" shows
 * even when Kumasi has plenty). Counts and lists cover active products only.
 */
export async function getInventoryStatus(branchId: string | null = null) {
  const scope = branchSql('s', branchId)
  const [[{ cnt: totalProducts }], totalLowStock, totalOutOfStock, lowStockItems, outOfStockItems] = await Promise.all([
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(DISTINCT p.id)::int as cnt FROM "BranchStock" s JOIN "Product" p ON p.id = s.product_id
      WHERE p.is_active = true ${scope}`,
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::int as cnt FROM "BranchStock" s JOIN "Product" p ON p.id = s.product_id
      WHERE p.is_active = true AND s.quantity > 0 AND s.quantity <= s.low_stock_threshold ${scope}`,
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::int as cnt FROM "BranchStock" s JOIN "Product" p ON p.id = s.product_id
      WHERE p.is_active = true AND s.quantity = 0 ${scope}`,
    prisma.$queryRaw<{ id: string; name: string; sku: string; quantity: number; low_stock_threshold: number; branch: string }[]>`
      SELECT p.id, p.name, p.sku, s.quantity, s.low_stock_threshold, b.name AS branch
      FROM "BranchStock" s JOIN "Product" p ON p.id = s.product_id JOIN "Branch" b ON b.id = s.branch_id
      WHERE p.is_active = true AND s.quantity > 0 AND s.quantity <= s.low_stock_threshold ${scope}
      ORDER BY s.quantity ASC, p.name ASC
      LIMIT 20
    `,
    prisma.$queryRaw<{ id: string; name: string; sku: string; quantity: number; branch: string }[]>`
      SELECT p.id, p.name, p.sku, s.quantity, b.name AS branch
      FROM "BranchStock" s JOIN "Product" p ON p.id = s.product_id JOIN "Branch" b ON b.id = s.branch_id
      WHERE p.is_active = true AND s.quantity = 0 ${scope}
      ORDER BY p.name ASC
      LIMIT 20
    `,
  ])

  return {
    total_products: Number(totalProducts),
    low_stock_count: Number(totalLowStock[0].cnt),
    out_of_stock_count: Number(totalOutOfStock[0].cnt),
    low_stock: lowStockItems.map((r) => ({
      ...r,
      quantity: Number(r.quantity),
      low_stock_threshold: Number(r.low_stock_threshold),
    })),
    out_of_stock: outOfStockItems.map((r) => ({
      ...r,
      quantity: Number(r.quantity),
    })),
  }
}

export async function getProfitReport({ start_date, end_date, branchId = null }: ReportOptions) {
  const range = dateRange(start_date, end_date)
  const results = await prisma.$queryRaw<{ id: string; name: string; sku: string; revenue: number | null; cost: number | null; profit: number | null }[]>`
    SELECT
      p.id,
      p.name,
      p.sku,
      ROUND(SUM(COALESCE(si.total * (si.quantity - si.refunded_quantity) / si.quantity * (s.subtotal - s.discount_amount) / NULLIF(s.subtotal, 0), 0)), 2)::float as revenue,
      SUM((si.quantity - si.refunded_quantity) * COALESCE(si.unit_cost, p.cost_price, 0))::float as cost,
      ROUND(SUM(COALESCE(si.total * (si.quantity - si.refunded_quantity) / si.quantity * (s.subtotal - s.discount_amount) / NULLIF(s.subtotal, 0), 0) - ((si.quantity - si.refunded_quantity) * COALESCE(si.unit_cost, p.cost_price, 0))), 2)::float as profit
    FROM "SaleItem" si
    JOIN "Product" p ON p.id = si.product_id
    JOIN "Sale" s ON s.id = si.sale_id
    WHERE s.created_at >= ${range.gte} AND s.created_at <= ${range.lte}
      AND s.payment_status IN ('COMPLETED', 'PARTIALLY_REFUNDED')
      ${branchSql('s', branchId)}
    GROUP BY p.id, p.name, p.sku
    ORDER BY profit DESC
  `
  return results.map((r) => {
    const revenue = Number(r.revenue || 0)
    const cost = Number(r.cost || 0)
    const profit = Number(r.profit || 0)
    return {
      id: r.id,
      name: r.name,
      sku: r.sku,
      revenue,
      cost,
      profit,
      margin: revenue > 0 ? (profit / revenue) * 100 : 0,
    }
  })
}

export async function getDashboardSummary(branchId: string | null = null) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  const [todaySales, lowStockCount, topProducts] = await Promise.all([
    prisma.$queryRaw<{ count: number; revenue: number }[]>`
      SELECT COUNT(*)::int AS count, COALESCE(SUM(total_amount - refunded_amount), 0)::float AS revenue
      FROM "Sale"
      WHERE created_at >= ${today} AND created_at <= ${todayEnd}
        AND payment_status IN ('COMPLETED', 'PARTIALLY_REFUNDED')
        ${branchSql('"Sale"', branchId)}
    `,
    // Includes out-of-stock items, matching GET /inventory/low-stock
    getLowStockCount(branchId),
    prisma.$queryRaw<{ name: string; revenue: number | null; quantity: number }[]>`
      SELECT p.name, ROUND(SUM(si.total * (si.quantity - si.refunded_quantity) / si.quantity * (s.subtotal - s.discount_amount) / NULLIF(s.subtotal, 0)), 2)::float as revenue, SUM(si.quantity - si.refunded_quantity)::int as quantity
      FROM "SaleItem" si
      JOIN "Product" p ON p.id = si.product_id
      JOIN "Sale" s ON s.id = si.sale_id
      WHERE s.payment_status IN ('COMPLETED', 'PARTIALLY_REFUNDED')
        ${branchSql('s', branchId)}
      GROUP BY p.id, p.name
      ORDER BY revenue DESC
      LIMIT 5
    `,
  ])

  return {
    today_revenue: Number(todaySales[0].revenue || 0),
    today_transactions: todaySales[0].count,
    low_stock_alerts: lowStockCount,
    top_products: topProducts.map((r) => ({ name: r.name, revenue: Number(r.revenue || 0), quantity: r.quantity })),
  }
}

/**
 * Every branch side by side for a date range: revenue (net of returns), transactions and refunds,
 * as { label, value } rows for a chart. Open branches with no sales still appear, with zeros; closed
 * ones only when they sold something in the period.
 */
export async function getBranchPerformance({ start_date, end_date }: ReportOptions) {
  const range = dateRange(start_date, end_date)
  const rows = await prisma.$queryRaw<{ id: string; label: string; code: string; transactions: number; value: number; refunds: number }[]>`
    SELECT b.id, b.name AS label, b.code,
      COUNT(s.id)::int AS transactions,
      COALESCE(SUM(s.total_amount - s.refunded_amount), 0)::float AS value,
      -- Money each branch paid out in returns in the period, whichever branch made the sale
      COALESCE((
        SELECT SUM(r.amount) FROM "Refund" r
        WHERE r.branch_id = b.id AND r.created_at >= ${range.gte} AND r.created_at <= ${range.lte}
      ), 0)::float AS refunds
    FROM "Branch" b
    LEFT JOIN "Sale" s
      ON s.branch_id = b.id
      AND s.created_at >= ${range.gte} AND s.created_at <= ${range.lte}
      AND s.payment_status IN ('COMPLETED', 'PARTIALLY_REFUNDED')
    GROUP BY b.id, b.name, b.code, b.is_active
    -- A closed branch only appears when it sold something in the period
    HAVING b.is_active OR COUNT(s.id) > 0
    ORDER BY value DESC, b.name ASC
  `
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    code: r.code,
    value: Number(r.value || 0),
    transactions: r.transactions,
    refunds: Number(r.refunds || 0),
  }))
}

export async function getCashierStats(userId: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  const [[salesAgg], [itemsAgg], recentSales] = await Promise.all([
    prisma.$queryRaw<{ count: number; revenue: number }[]>`
      SELECT COUNT(*)::int AS count, COALESCE(SUM(total_amount - refunded_amount), 0)::float AS revenue
      FROM "Sale"
      WHERE user_id = ${userId} AND created_at >= ${today} AND created_at <= ${todayEnd}
        AND payment_status IN ('COMPLETED', 'PARTIALLY_REFUNDED')
    `,
    prisma.$queryRaw<{ items: number }[]>`
      SELECT COALESCE(SUM(si.quantity - si.refunded_quantity), 0)::int AS items
      FROM "SaleItem" si
      JOIN "Sale" s ON s.id = si.sale_id
      WHERE s.user_id = ${userId} AND s.created_at >= ${today} AND s.created_at <= ${todayEnd}
        AND s.payment_status IN ('COMPLETED', 'PARTIALLY_REFUNDED')
    `,
    prisma.sale.findMany({
      where: { user_id: userId, payment_status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED'] } },
      orderBy: { created_at: 'desc' },
      take: 5,
      select: {
        id: true,
        transaction_id: true,
        total_amount: true,
        payment_method: true,
        created_at: true,
        customer: { select: { name: true } },
      },
    }),
  ])

  return {
    sales_count: salesAgg.count,
    total_revenue: salesAgg.revenue,
    items_sold: itemsAgg.items,
    average_sale: salesAgg.count > 0 ? Math.round((salesAgg.revenue / salesAgg.count) * 100) / 100 : 0,
    recent_sales: recentSales.map((s) => ({
      id: s.id,
      transaction_id: s.transaction_id,
      total_amount: Number(s.total_amount),
      payment_method: s.payment_method,
      created_at: s.created_at,
      customer_name: s.customer?.name || null,
    })),
  }
}

