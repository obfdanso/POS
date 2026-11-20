import type { PaymentStatus, Prisma } from '@prisma/client'
import prisma from '../utils/prismaClient'
import { buildOrderBy, type SortDirection } from '../middleware/sorting'
import { NotFoundError, ConflictError } from '../utils/errors'

// Sales the customer kept at least part of
const KEPT_STATUSES: PaymentStatus[] = ['COMPLETED', 'PARTIALLY_REFUNDED']

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export const CUSTOMER_SORTS: Record<string, (dir: SortDirection) => Prisma.CustomerOrderByWithRelationInput> = {
  name: (dir) => ({ name: dir }),
  phone: (dir) => ({ phone: { sort: dir, nulls: 'last' } }),
  email: (dir) => ({ email: { sort: dir, nulls: 'last' } }),
  loyalty_points: (dir) => ({ loyalty_points: dir }),
  created_at: (dir) => ({ created_at: dir }),
}

export interface ListCustomersOptions {
  page?: number
  per_page?: number
  search?: string
  sort?: string
  order?: string
}

export async function listCustomers({ page = 1, per_page = 20, search, sort, order }: ListCustomersOptions = {}) {
  const skip = (page - 1) * per_page
  const take = Math.min(per_page, 100)

  const where: Prisma.CustomerWhereInput = {}
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      skip,
      take,
      orderBy: buildOrderBy({ sort, order }, CUSTOMER_SORTS, { name: 'asc' }),
      include: { _count: { select: { sales: true } } },
    }),
    prisma.customer.count({ where }),
  ])

  // Lifetime spend for this page of customers, aggregated in SQL, net of returns
  const totals = await prisma.sale.groupBy({
    by: ['customer_id'],
    where: { customer_id: { in: customers.map((c) => c.id) }, payment_status: { in: KEPT_STATUSES } },
    _sum: { total_amount: true, refunded_amount: true },
  })
  const spentById = new Map(
    totals.map((t) => [t.customer_id, round2(Number(t._sum.total_amount ?? 0) - Number(t._sum.refunded_amount ?? 0))])
  )
  const withTotals = customers.map((c) => ({ ...c, total_purchases: spentById.get(c.id) ?? 0 }))

  return { customers: withTotals, total, page, per_page: take, total_pages: Math.ceil(total / take) }
}

export async function getCustomerById(id: string) {
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      _count: { select: { sales: true } },
    },
  })
  if (!customer) throw new NotFoundError('Customer not found')

  // Purchase history summary, net of returns (fully refunded sales excluded)
  const stats = await prisma.sale.aggregate({
    where: { customer_id: id, payment_status: { in: KEPT_STATUSES } },
    _sum: { total_amount: true, refunded_amount: true },
    _count: { id: true },
    _max: { created_at: true },
  })
  const totalSpent = round2(Number(stats._sum.total_amount ?? 0) - Number(stats._sum.refunded_amount ?? 0))

  return {
    ...customer,
    purchase_summary: {
      total_spent: totalSpent,
      purchase_count: stats._count.id,
      average_purchase: stats._count.id > 0 ? round2(totalSpent / stats._count.id) : 0,
      last_purchase_at: stats._max.created_at,
    },
  }
}

export interface CustomerInput {
  name: string
  phone?: string | null
  email?: string | null
  address?: string | null
}

export async function createCustomer(data: CustomerInput) {
  if (data.phone) {
    const existing = await prisma.customer.findUnique({ where: { phone: data.phone } })
    if (existing) throw new ConflictError('Phone number already registered', 'phone')
  }
  if (data.email) {
    const existing = await prisma.customer.findUnique({ where: { email: data.email } })
    if (existing) throw new ConflictError('Email already registered', 'email')
  }

  const customer = await prisma.customer.create({
    data: {
      name: data.name.trim(),
      phone: data.phone || null,
      email: data.email || null,
      address: data.address || null,
    },
  })

  return customer
}

export async function updateCustomer(id: string, data: Partial<CustomerInput>) {
  const existing = await prisma.customer.findUnique({ where: { id } })
  if (!existing) throw new NotFoundError('Customer not found')

  if (data.phone && data.phone !== existing.phone) {
    const conflict = await prisma.customer.findUnique({ where: { phone: data.phone } })
    if (conflict) throw new ConflictError('Phone number already registered', 'phone')
  }
  if (data.email && data.email !== existing.email) {
    const conflict = await prisma.customer.findUnique({ where: { email: data.email } })
    if (conflict) throw new ConflictError('Email already registered', 'email')
  }

  return prisma.customer.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.phone !== undefined && { phone: data.phone || null }),
      ...(data.email !== undefined && { email: data.email || null }),
      ...(data.address !== undefined && { address: data.address || null }),
    },
  })
}

export interface CustomerPurchasesOptions {
  page?: number
  per_page?: number
  userId?: string
  branchId?: string | null
}

/**
 * Pass userId to restrict the list to one cashier's sales. With `branchId` (a manager), other
 * branches' sales lose their id and transaction ID, so a return there still goes through the
 * receipt lookup.
 */
export async function getCustomerPurchases(id: string, { page = 1, per_page = 20, userId, branchId }: CustomerPurchasesOptions = {}) {
  const customer = await prisma.customer.findUnique({ where: { id } })
  if (!customer) throw new NotFoundError('Customer not found')

  const skip = (page - 1) * per_page
  const take = Math.min(per_page, 100)

  const [sales, total] = await Promise.all([
    prisma.sale.findMany({
      where: { customer_id: id, ...(userId && { user_id: userId }) },
      skip,
      take,
      orderBy: { created_at: 'desc' },
      include: {
        _count: { select: { sale_items: true } },
        user: { select: { full_name: true } },
        branch: { select: { name: true, code: true } },
      },
    }),
    prisma.sale.count({ where: { customer_id: id, ...(userId && { user_id: userId }) } }),
  ])

  const shown = branchId
    ? sales.map((s) => (s.branch_id === branchId ? s : { ...s, id: null, transaction_id: null, other_branch: true }))
    : sales
  return { sales: shown, total, page, per_page: take, total_pages: Math.ceil(total / take) }
}
