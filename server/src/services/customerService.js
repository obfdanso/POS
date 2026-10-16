const prisma = require('../utils/prismaClient')
const { buildOrderBy } = require('../middleware/sorting')
const { NotFoundError, ConflictError } = require('../utils/errors')

const CUSTOMER_SORTS = {
  name: (dir) => ({ name: dir }),
  phone: (dir) => ({ phone: { sort: dir, nulls: 'last' } }),
  email: (dir) => ({ email: { sort: dir, nulls: 'last' } }),
  loyalty_points: (dir) => ({ loyalty_points: dir }),
  created_at: (dir) => ({ created_at: dir }),
}

async function listCustomers({ page = 1, per_page = 20, search, sort, order } = {}) {
  const skip = (page - 1) * per_page
  const take = Math.min(per_page, 100)

  const where = {}
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

  // Lifetime spend for this page of customers, aggregated in SQL (refunded sales excluded)
  const totals = await prisma.sale.groupBy({
    by: ['customer_id'],
    where: { customer_id: { in: customers.map((c) => c.id) }, payment_status: 'COMPLETED' },
    _sum: { total_amount: true },
  })
  const spentById = new Map(totals.map((t) => [t.customer_id, parseFloat(t._sum.total_amount || 0)]))
  const withTotals = customers.map((c) => ({ ...c, total_purchases: spentById.get(c.id) ?? 0 }))

  return { customers: withTotals, total, page, per_page: take, total_pages: Math.ceil(total / take) }
}

async function getCustomerById(id) {
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      _count: { select: { sales: true } },
    },
  })
  if (!customer) throw new NotFoundError('Customer not found')

  // Purchase history summary (refunded sales excluded)
  const stats = await prisma.sale.aggregate({
    where: { customer_id: id, payment_status: 'COMPLETED' },
    _sum: { total_amount: true },
    _avg: { total_amount: true },
    _count: { id: true },
    _max: { created_at: true },
  })

  return {
    ...customer,
    purchase_summary: {
      total_spent: parseFloat(stats._sum.total_amount || 0),
      purchase_count: stats._count.id,
      average_purchase: parseFloat(stats._avg.total_amount || 0),
      last_purchase_at: stats._max.created_at,
    },
  }
}

async function createCustomer(data) {
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

async function updateCustomer(id, data) {
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

async function getCustomerPurchases(id, { page = 1, per_page = 20 } = {}) {
  const customer = await prisma.customer.findUnique({ where: { id } })
  if (!customer) throw new NotFoundError('Customer not found')

  const skip = (page - 1) * per_page
  const take = Math.min(per_page, 100)

  const [sales, total] = await Promise.all([
    prisma.sale.findMany({
      where: { customer_id: id },
      skip,
      take,
      orderBy: { created_at: 'desc' },
      include: {
        _count: { select: { sale_items: true } },
        user: { select: { full_name: true } },
      },
    }),
    prisma.sale.count({ where: { customer_id: id } }),
  ])

  return { sales, total, page, per_page: take, total_pages: Math.ceil(total / take) }
}

module.exports = { CUSTOMER_SORTS, listCustomers, getCustomerById, createCustomer, updateCustomer, getCustomerPurchases }
