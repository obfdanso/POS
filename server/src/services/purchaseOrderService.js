const prisma = require('../utils/prismaClient')
const { buildOrderBy } = require('../middleware/sorting')
const { NotFoundError, ValidationError } = require('../utils/errors')
const { recordAudit } = require('../utils/audit')
const { buildDateRange } = require('../utils/dateRange')
const { changeStock } = require('../utils/branchStock')

const PO_INCLUDE = {
  supplier: { select: { id: true, name: true, phone: true, email: true } },
  created_by: { select: { id: true, full_name: true } },
  branch: { select: { id: true, name: true, code: true } },
  items: {
    include: { product: { select: { id: true, name: true, sku: true, cost_price: true } } },
    orderBy: { created_at: 'asc' },
  },
}

const PO_SORTS = {
  created_at: (dir) => ({ created_at: dir }),
  po_number: (dir) => ({ po_number: dir }),
  status: (dir) => [{ status: dir }, { created_at: 'desc' }],
  total_cost: (dir) => ({ total_cost: dir }),
  expected_at: (dir) => [{ expected_at: { sort: dir, nulls: 'last' } }, { created_at: 'desc' }],
  supplier: (dir) => [{ supplier: { name: dir } }, { created_at: 'desc' }],
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

// PO-YYYYMMDD-NNNN, numbered after the highest number issued that day
async function nextPoNumber(tx, now = new Date()) {
  const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const prefix = `PO-${day}-`
  const [latest] = await tx.$queryRaw`
    SELECT po_number FROM "PurchaseOrder"
    WHERE po_number LIKE ${prefix + '%'}
    ORDER BY LENGTH(po_number) DESC, po_number DESC
    LIMIT 1
  `
  const last = latest ? parseInt(latest.po_number.slice(prefix.length), 10) : 0
  return `${prefix}${String(last + 1).padStart(4, '0')}`
}

/** One line per item with what is still to come, plus totals, for the API and the UI. */
function withProgress(po) {
  const items = po.items.map((i) => ({ ...i, quantity_outstanding: i.quantity_ordered - i.quantity_received }))
  return {
    ...po,
    items,
    units_ordered: items.reduce((n, i) => n + i.quantity_ordered, 0),
    units_received: items.reduce((n, i) => n + i.quantity_received, 0),
  }
}

/** An order of goods to be delivered to `branchId`. */
async function createPurchaseOrder({ supplier_id, items, expected_at, notes }, userId, branchId) {
  const supplier = await prisma.supplier.findUnique({ where: { id: supplier_id }, select: { id: true, name: true } })
  if (!supplier) throw new ValidationError('Supplier not found', [{ field: 'supplier_id', message: 'Supplier does not exist' }])

  const ids = items.map((i) => i.product_id)
  if (new Set(ids).size !== ids.length) {
    throw new ValidationError('Duplicate product', [{ field: 'items', message: 'Each product can appear only once; change its quantity instead' }])
  }
  const products = await prisma.product.findMany({ where: { id: { in: ids }, is_active: true }, select: { id: true } })
  if (products.length !== ids.length) {
    throw new ValidationError('Product not found', [{ field: 'items', message: 'Every item must be an active product' }])
  }

  const lines = items.map((i) => ({ product_id: i.product_id, quantity_ordered: i.quantity, unit_cost: round2(i.unit_cost) }))
  const total = round2(lines.reduce((sum, l) => sum + l.quantity_ordered * l.unit_cost, 0))

  // Two orders created at once can pick the same number; the unique index rejects one, which retries
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.create({
          data: {
            po_number: await nextPoNumber(tx),
            supplier_id,
            created_by_id: userId,
            branch_id: branchId,
            total_cost: total,
            expected_at: expected_at ? new Date(expected_at) : null,
            notes: notes || null,
            items: { create: lines },
          },
          include: PO_INCLUDE,
        })
        await recordAudit(
          { userId, action: 'PURCHASE_ORDER_CREATED', entity: 'PurchaseOrder', entityId: po.id, details: `${po.po_number} to ${supplier.name}: ${total.toFixed(2)}` },
          tx
        )
        return withProgress(po)
      })
    } catch (err) {
      const target = err.code === 'P2002' ? String(err.meta?.target ?? '') : ''
      if (!target.includes('po_number') || attempt >= 5) throw err
    }
  }
}

/** With a `user`, managers may only reach their own branch's orders (others look missing). */
function assertBranchAccess(po, user) {
  if (user && user.role !== 'ADMIN' && po.branch_id !== user.branch_id) throw new NotFoundError('Purchase order not found')
}

async function getPurchaseOrder(id, user = null) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, include: PO_INCLUDE })
  if (!po) throw new NotFoundError('Purchase order not found')
  assertBranchAccess(po, user)
  return withProgress(po)
}

async function listPurchaseOrders({ page = 1, per_page = 20, status, supplier_id, search, start_date, end_date, sort, order, branchId = null } = {}) {
  const take = Math.min(per_page, 100)
  const where = {}
  if (branchId) where.branch_id = branchId
  if (status) where.status = status
  if (supplier_id) where.supplier_id = supplier_id
  if (search) where.po_number = { contains: search.trim(), mode: 'insensitive' }
  if (start_date || end_date) where.created_at = buildDateRange(start_date, end_date)

  const [orders, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      skip: (page - 1) * take,
      take,
      include: {
        supplier: { select: { id: true, name: true } },
        created_by: { select: { id: true, full_name: true } },
        branch: { select: { id: true, name: true, code: true } },
        items: { select: { quantity_ordered: true, quantity_received: true } },
      },
      orderBy: buildOrderBy({ sort, order }, PO_SORTS, { created_at: 'desc' }),
    }),
    prisma.purchaseOrder.count({ where }),
  ])

  const rows = orders.map(({ items, ...po }) => ({
    ...po,
    item_count: items.length,
    units_ordered: items.reduce((n, i) => n + i.quantity_ordered, 0),
    units_received: items.reduce((n, i) => n + i.quantity_received, 0),
  }))
  return { orders: rows, total, page, per_page: take, total_pages: Math.ceil(total / take) }
}

/**
 * Records a delivery: adds each received quantity to stock with a RESTOCK log, and (unless
 * update_cost is false) sets the product's cost price to what this order paid. With no `items`,
 * everything still outstanding is received.
 */
async function receivePurchaseOrder(id, user, { items, update_cost = true, notes } = {}) {
  const userId = user.id
  return prisma.$transaction(async (tx) => {
    // Lock the order so two people receiving the same delivery can't both add the stock
    const locked = await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${id} FOR UPDATE`
    if (locked.length === 0) throw new NotFoundError('Purchase order not found')
    const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: { include: { product: { select: { name: true } } } } } })
    assertBranchAccess(po, user)
    if (!['ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
      throw new ValidationError('Order closed', [{ field: 'status', message: `This order is ${po.status.toLowerCase().replace('_', ' ')} and can't receive more goods` }])
    }

    const lines = new Map(po.items.map((i) => [i.id, i]))
    const requested = (items ?? po.items.map((i) => ({ item_id: i.id, quantity: i.quantity_ordered - i.quantity_received })))
      .filter((r) => r.quantity > 0)
    if (requested.length === 0) {
      throw new ValidationError('Nothing to receive', [{ field: 'items', message: 'Enter a quantity for at least one item' }])
    }
    const seen = new Set()
    for (const r of requested) {
      const line = lines.get(r.item_id)
      if (!line) throw new ValidationError('Item not on this order', [{ field: 'items', message: 'Each item must belong to this purchase order' }])
      if (seen.has(r.item_id)) throw new ValidationError('Duplicate item', [{ field: 'items', message: `"${line.product.name}" is listed more than once` }])
      seen.add(r.item_id)
      const outstanding = line.quantity_ordered - line.quantity_received
      if (r.quantity > outstanding) {
        throw new ValidationError('Too many received', [
          { field: 'items', message: `Only ${outstanding} more of "${line.product.name}" ${outstanding === 1 ? 'is' : 'are'} expected` },
        ])
      }
    }

    for (const r of requested) {
      const line = lines.get(r.item_id)
      await tx.purchaseOrderItem.update({ where: { id: line.id }, data: { quantity_received: { increment: r.quantity } } })
      if (update_cost) await tx.product.update({ where: { id: line.product_id }, data: { cost_price: line.unit_cost } })
      // Goods go into the ordering branch's stock; a product it didn't carry, it now does
      await changeStock(tx, {
        branchId: po.branch_id,
        productId: line.product_id,
        change: r.quantity,
        type: 'RESTOCK',
        userId,
        notes: `Received on ${po.po_number}${notes ? `: ${notes}` : ''}`.slice(0, 500),
        createIfMissing: true,
      })
    }

    const after = await tx.purchaseOrderItem.findMany({ where: { purchase_order_id: id }, select: { quantity_ordered: true, quantity_received: true } })
    const complete = after.every((i) => i.quantity_received === i.quantity_ordered)
    await tx.purchaseOrder.update({
      where: { id },
      data: { status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED', ...(complete && { received_at: new Date() }) },
    })
    const units = requested.reduce((n, r) => n + r.quantity, 0)
    await recordAudit(
      { userId, action: 'PURCHASE_ORDER_RECEIVED', entity: 'PurchaseOrder', entityId: id, details: `${po.po_number}: ${units} unit${units === 1 ? '' : 's'} received${complete ? ' (complete)' : ''}` },
      tx
    )
  }).then(() => getPurchaseOrder(id, user))
}

/** Closes an order that won't (fully) arrive. Goods already received stay in stock. */
async function cancelPurchaseOrder(id, user, reason) {
  const userId = user.id
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, select: { po_number: true, branch_id: true } })
  if (!po) throw new NotFoundError('Purchase order not found')
  assertBranchAccess(po, user)
  // The status guard means a delivery being received at the same moment can't be cancelled under it
  const { count } = await prisma.purchaseOrder.updateMany({
    where: { id, status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] } },
    data: { status: 'CANCELLED' },
  })
  if (count === 0) {
    throw new ValidationError('Order closed', [{ field: 'status', message: 'Only open orders can be cancelled' }])
  }
  await recordAudit({ userId, action: 'PURCHASE_ORDER_CANCELLED', entity: 'PurchaseOrder', entityId: id, details: `${po.po_number}${reason ? `: ${reason}` : ''}` })
  return getPurchaseOrder(id, user)
}

/**
 * A supplier's active products at or below their low-stock level at a branch, with a suggested
 * order that brings each back to twice its threshold, less anything already on that branch's open
 * orders.
 */
async function getReorderSuggestions(supplierId, branchId) {
  const rows = await prisma.$queryRaw`
    SELECT p.id, p.name, p.sku, s.quantity, s.low_stock_threshold, p.cost_price,
           COALESCE(SUM(poi.quantity_ordered - poi.quantity_received) FILTER (WHERE po.status IN ('ORDERED', 'PARTIALLY_RECEIVED')), 0)::int AS on_order
    FROM "BranchStock" s
    JOIN "Product" p ON p.id = s.product_id
    LEFT JOIN "PurchaseOrderItem" poi ON poi.product_id = p.id
    LEFT JOIN "PurchaseOrder" po ON po.id = poi.purchase_order_id AND po.branch_id = s.branch_id
    WHERE s.branch_id = ${branchId} AND p.supplier_id = ${supplierId} AND p.is_active = true AND s.quantity <= s.low_stock_threshold
    GROUP BY p.id, s.quantity, s.low_stock_threshold
    ORDER BY s.quantity ASC, p.name ASC
  `
  return rows
    .map((r) => {
      const target = Math.max(r.low_stock_threshold * 2, 1)
      return {
        product_id: r.id,
        name: r.name,
        sku: r.sku,
        quantity: r.quantity,
        low_stock_threshold: r.low_stock_threshold,
        on_order: r.on_order,
        unit_cost: r.cost_price === null ? null : Number(r.cost_price),
        suggested_quantity: Math.max(target - r.quantity - r.on_order, 0),
      }
    })
    .filter((r) => r.suggested_quantity > 0)
}

module.exports = {
  PO_SORTS,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  receivePurchaseOrder,
  cancelPurchaseOrder,
  getReorderSuggestions,
}
