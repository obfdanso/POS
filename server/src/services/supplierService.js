const prisma = require('../utils/prismaClient')
const { NotFoundError, ConflictError } = require('../utils/errors')

async function listSuppliers({ page = 1, per_page = 50, search } = {}) {
  const skip = (page - 1) * per_page
  const take = Math.min(per_page, 100)

  const where = {}
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { address: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [suppliers, total] = await Promise.all([
    prisma.supplier.findMany({
      where,
      skip,
      take,
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: { where: { is_active: true } } } } },
    }),
    prisma.supplier.count({ where }),
  ])

  return {
    data: suppliers.map((s) => ({ ...s, product_count: s._count.products })),
    meta: {
      page,
      per_page: take,
      total,
      total_pages: Math.ceil(total / take),
    },
  }
}

async function getSupplierById(id) {
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      products: {
        where: { is_active: true },
        select: { id: true, name: true, sku: true, price: true, quantity: true, category: { select: { name: true } } },
        orderBy: { name: 'asc' },
      },
    },
  })
  if (!supplier) throw new NotFoundError('Supplier not found')
  return supplier
}

async function createSupplier({ name, phone, email, address, website }) {
  const existing = await prisma.supplier.findUnique({ where: { name } })
  if (existing) throw new ConflictError(`Supplier "${name}" already exists`, 'name')

  return prisma.supplier.create({ data: { name, phone, email, address, website } })
}

async function updateSupplier(id, { name, phone, email, address, website }) {
  const supplier = await prisma.supplier.findUnique({ where: { id } })
  if (!supplier) throw new NotFoundError('Supplier not found')

  if (name && name !== supplier.name) {
    const existing = await prisma.supplier.findUnique({ where: { name } })
    if (existing) throw new ConflictError(`Supplier "${name}" already exists`, 'name')
  }

  return prisma.supplier.update({
    where: { id },
    data: { name, phone, email, address, website },
  })
}

async function deleteSupplier(id) {
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: { _count: { select: { products: { where: { is_active: true } } } } },
  })
  if (!supplier) throw new NotFoundError('Supplier not found')
  if (supplier._count.products > 0) {
    throw new ConflictError(
      `Cannot delete supplier "${supplier.name}" — it is linked to ${supplier._count.products} active product(s). Reassign products first.`
    )
  }
  await prisma.supplier.delete({ where: { id } })
  return true
}

module.exports = { listSuppliers, getSupplierById, createSupplier, updateSupplier, deleteSupplier }
