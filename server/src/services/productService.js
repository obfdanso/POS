const prisma = require('../utils/prismaClient')
const { NotFoundError, ConflictError, ForbiddenError } = require('../utils/errors')

// status: 'active' (default), 'inactive', or 'all'
async function listProducts({ page = 1, per_page = 20, search, category_id, status = 'active' } = {}) {
  const skip = (page - 1) * per_page
  const take = Math.min(per_page, 100)

  const where = {}
  if (status === 'active') where.is_active = true
  if (status === 'inactive') where.is_active = false
  if (category_id) where.category_id = category_id
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { barcode: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take,
      include: {
        category: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.product.count({ where }),
  ])

  return { products, total, page, per_page: take, total_pages: Math.ceil(total / take) }
}

async function getProductById(id) {
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
    },
  })
  if (!product) throw new NotFoundError('Product not found')
  return product
}

async function getProductByBarcode(barcode) {
  const product = await prisma.product.findUnique({
    where: { barcode },
    include: {
      category: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
    },
  })
  if (!product) throw new NotFoundError('Product not found')
  if (!product.is_active) throw new NotFoundError('Product is inactive')
  return product
}

async function createProduct(data, userId) {
  // Check uniqueness
  const [existingSku, existingBarcode] = await Promise.all([
    prisma.product.findUnique({ where: { sku: data.sku } }),
    data.barcode ? prisma.product.findUnique({ where: { barcode: data.barcode } }) : null,
  ])

  if (existingSku) throw new ConflictError('SKU already exists')
  if (existingBarcode) throw new ConflictError('Barcode already exists')

  // Check category exists
  const category = await prisma.category.findUnique({ where: { id: data.category_id } })
  if (!category) throw new NotFoundError('Category not found')

  const quantity = data.quantity ?? 0

  // Create the product and log its opening stock together
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        name: data.name,
        sku: data.sku,
        barcode: data.barcode || null,
        category_id: data.category_id,
        supplier_id: data.supplier_id || null,
        price: data.price,
        cost_price: data.cost_price || null,
        quantity,
        low_stock_threshold: data.low_stock_threshold ?? 10,
        image_url: data.image_url || null,
        is_active: data.is_active ?? true,
      },
      include: {
        category: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
      },
    })

    if (quantity > 0) {
      await tx.inventoryLog.create({
        data: {
          product_id: product.id,
          change_type: 'RESTOCK',
          quantity_change: quantity,
          previous_quantity: 0,
          new_quantity: quantity,
          user_id: userId,
          notes: 'Opening stock',
        },
      })
    }

    return product
  })
}

async function updateProduct(id, data, user) {
  const existing = await prisma.product.findUnique({ where: { id } })
  if (!existing) throw new NotFoundError('Product not found')

  // Activating/deactivating mirrors DELETE /products/:id, which is ADMIN-only
  if (data.is_active !== undefined && data.is_active !== existing.is_active && user?.role !== 'ADMIN') {
    throw new ForbiddenError('Only an admin can activate or deactivate products')
  }

  // Check uniqueness (exclude self)
  if (data.sku && data.sku !== existing.sku) {
    const conflict = await prisma.product.findUnique({ where: { sku: data.sku } })
    if (conflict) throw new ConflictError('SKU already exists')
  }
  if (data.barcode && data.barcode !== existing.barcode) {
    const conflict = await prisma.product.findUnique({ where: { barcode: data.barcode } })
    if (conflict) throw new ConflictError('Barcode already exists')
  }
  if (data.category_id) {
    const category = await prisma.category.findUnique({ where: { id: data.category_id } })
    if (!category) throw new NotFoundError('Category not found')
  }

  const product = await prisma.product.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.sku !== undefined && { sku: data.sku }),
      ...(data.barcode !== undefined && { barcode: data.barcode || null }),
      ...(data.category_id !== undefined && { category_id: data.category_id }),
      ...(data.supplier_id !== undefined && { supplier_id: data.supplier_id || null }),
      ...(data.price !== undefined && { price: data.price }),
      ...(data.cost_price !== undefined && { cost_price: data.cost_price || null }),
      // quantity is intentionally not editable here — stock changes go through inventory so they are logged
      ...(data.low_stock_threshold !== undefined && { low_stock_threshold: data.low_stock_threshold }),
      ...(data.image_url !== undefined && { image_url: data.image_url || null }),
      ...(data.is_active !== undefined && { is_active: data.is_active }),
    },
    include: {
      category: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
    },
  })

  return product
}

async function softDeleteProduct(id) {
  const existing = await prisma.product.findUnique({ where: { id } })
  if (!existing) throw new NotFoundError('Product not found')

  await prisma.product.update({ where: { id }, data: { is_active: false } })
}

// ---- Categories ----

async function listCategories() {
  return prisma.category.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { products: true } } },
  })
}

async function createCategory(data) {
  const existing = await prisma.category.findUnique({ where: { name: data.name } })
  if (existing) throw new ConflictError('Category name already exists')

  return prisma.category.create({
    data: { name: data.name, description: data.description || null },
  })
}

async function updateCategory(id, data) {
  const existing = await prisma.category.findUnique({ where: { id } })
  if (!existing) throw new NotFoundError('Category not found')

  if (data.name && data.name !== existing.name) {
    const conflict = await prisma.category.findUnique({ where: { name: data.name } })
    if (conflict) throw new ConflictError('Category name already exists')
  }

  return prisma.category.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description || null }),
    },
  })
}

module.exports = {
  listProducts,
  getProductById,
  getProductByBarcode,
  createProduct,
  updateProduct,
  softDeleteProduct,
  listCategories,
  createCategory,
  updateCategory,
}
