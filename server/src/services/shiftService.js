const prisma = require('../utils/prismaClient')
const { ConflictError, ForbiddenError, NotFoundError, ValidationError } = require('../utils/errors')
const { recordAudit } = require('../utils/audit')
const { buildDateRange } = require('../utils/dateRange')
const { buildOrderBy } = require('../middleware/sorting')

const PEOPLE = {
  user: { select: { id: true, username: true, full_name: true } },
  closed_by: { select: { id: true, username: true, full_name: true } },
}

// Half-up to 2 decimals; EPSILON stops values like 1.005 (stored as 1.00499…) rounding down
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** The user's open shift, or null. Pass a transaction client as `db` to read inside a transaction. */
function getOpenShift(userId, db = prisma) {
  return db.shift.findFirst({ where: { user_id: userId, status: 'OPEN' }, include: PEOPLE })
}

/**
 * Takings for a shift, aggregated in SQL: money taken by payment method (a split sale counts
 * towards each method it used), cash refunds paid out of the drawer, and the cash the drawer should
 * hold (opening float + cash taken − cash refunds).
 */
async function getShiftTotals(shift, db = prisma) {
  const [paymentsByMethod, sales, split_count, cashRefunds] = await Promise.all([
    db.payment.groupBy({
      by: ['method'],
      where: { sale: { shift_id: shift.id } },
      _sum: { amount_paid: true, change_given: true },
      _count: { id: true },
    }),
    db.sale.aggregate({ where: { shift_id: shift.id }, _sum: { total_amount: true }, _count: { id: true } }),
    db.sale.count({ where: { shift_id: shift.id, payment_method: 'SPLIT' } }),
    // Cash paid back to customers from this drawer (refunds processed while this shift was open)
    db.refund.aggregate({ where: { shift_id: shift.id }, _sum: { cash_amount: true } }),
  ])

  const by_method = {
    CASH: { count: 0, total: 0 },
    MOBILE_MONEY: { count: 0, total: 0 },
    CARD: { count: 0, total: 0 },
  }
  for (const row of paymentsByMethod) {
    by_method[row.method] = {
      count: row._count.id,
      total: round2(parseFloat(row._sum.amount_paid || 0) - parseFloat(row._sum.change_given || 0)),
    }
  }

  const sales_count = sales._count.id
  const sales_total = round2(parseFloat(sales._sum.total_amount || 0))
  const cash_sales = by_method.CASH.total
  const cash_refunds = parseFloat(cashRefunds._sum.cash_amount || 0)
  const expected_cash = round2(parseFloat(shift.opening_float) + cash_sales - cash_refunds)

  return { sales_count, sales_total, by_method, split_count, cash_sales, cash_refunds, expected_cash }
}

async function withTotals(shift, db = prisma) {
  return shift && { ...shift, summary: await getShiftTotals(shift, db) }
}

async function getCurrentShift(userId) {
  return withTotals(await getOpenShift(userId))
}

async function openShift(userId, { opening_float, notes }) {
  if (await getOpenShift(userId)) {
    throw new ConflictError('You already have an open shift. Close it before opening another.')
  }
  try {
    const shift = await prisma.shift.create({
      data: { user_id: userId, opening_float, notes: notes || null },
      include: PEOPLE,
    })
    return withTotals(shift)
  } catch (err) {
    // Two open requests at once: the partial unique index lets only one through
    if (err.code === 'P2002') throw new ConflictError('You already have an open shift. Close it before opening another.')
    throw err
  }
}

/** Cashiers may only see and close their own shifts; managers and admins any. */
function assertCanAccess(shift, user) {
  if (user.role === 'CASHIER' && shift.user_id !== user.id) {
    throw new ForbiddenError('You can only view your own shifts')
  }
}

async function closeShift(id, user, { counted_cash, notes }) {
  const shift = await prisma.shift.findUnique({ where: { id } })
  if (!shift) throw new NotFoundError('Shift not found')
  assertCanAccess(shift, user)

  const alreadyClosed = () =>
    new ValidationError('Shift already closed', [{ field: 'shift', message: 'This shift has already been closed' }])
  if (shift.status === 'CLOSED') throw alreadyClosed()

  await prisma.$transaction(async (tx) => {
    // Conditional, so two people closing the same shift can't both record a count
    const { count } = await tx.shift.updateMany({
      where: { id, status: 'OPEN' },
      data: { status: 'CLOSED', closed_at: new Date(), closed_by_id: user.id },
    })
    if (count === 0) throw alreadyClosed()

    const { expected_cash } = await getShiftTotals(shift, tx)
    const difference = round2(counted_cash - expected_cash)
    await tx.shift.update({
      where: { id },
      data: {
        expected_cash,
        counted_cash,
        difference,
        notes: [shift.notes, notes].filter(Boolean).join('\n') || null,
      },
    })

    const verdict = difference === 0 ? 'balanced' : difference > 0 ? `over by ${difference.toFixed(2)}` : `short by ${(-difference).toFixed(2)}`
    await recordAudit(
      {
        userId: user.id,
        action: 'SHIFT_CLOSED',
        entity: 'Shift',
        entityId: id,
        details: `Counted ${counted_cash.toFixed(2)}, expected ${expected_cash.toFixed(2)}: ${verdict}`,
      },
      tx
    )
  })

  return getShift(id, user)
}

async function getShift(id, user) {
  const shift = await prisma.shift.findUnique({ where: { id }, include: PEOPLE })
  if (!shift) throw new NotFoundError('Shift not found')
  assertCanAccess(shift, user)
  return withTotals(shift)
}

const SHIFT_SORTS = {
  opened_at: (dir) => ({ opened_at: dir }),
  closed_at: (dir) => [{ closed_at: { sort: dir, nulls: 'last' } }, { opened_at: 'desc' }],
  difference: (dir) => [{ difference: { sort: dir, nulls: 'last' } }, { opened_at: 'desc' }],
  cashier: (dir) => [{ user: { full_name: dir } }, { opened_at: 'desc' }],
}

async function listShifts({ page = 1, per_page = 20, user_id, status, start_date, end_date, sort, order }) {
  const take = Math.min(per_page, 100)
  const where = {}
  if (user_id) where.user_id = user_id
  if (status) where.status = status
  if (start_date || end_date) where.opened_at = buildDateRange(start_date, end_date)

  const [shifts, total] = await Promise.all([
    prisma.shift.findMany({
      where,
      include: { ...PEOPLE, _count: { select: { sales: true } } },
      orderBy: buildOrderBy({ sort, order }, SHIFT_SORTS, { opened_at: 'desc' }),
      skip: (page - 1) * take,
      take,
    }),
    prisma.shift.count({ where }),
  ])
  return { shifts, total, page, per_page: take, total_pages: Math.ceil(total / take) }
}

module.exports = { SHIFT_SORTS, getOpenShift, getCurrentShift, openShift, closeShift, getShift, listShifts }
