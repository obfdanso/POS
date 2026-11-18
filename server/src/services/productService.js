const prisma = require('../utils/prismaClient')
const { buildOrderBy } = require('../middleware/sorting')
const { recordAudit } = require('../utils/audit')
const { NotFoundError, ConflictError, ForbiddenError, ValidationError } = require('../utils/errors')

const PARENT = { select: { id: true, name: true, variant_name: true } }
const PRODUCT_INCLUDE = {
  category: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  parent: PARENT,
}
// What a product page or the till needs to know about each variant
const VARIANT_SELECT = {
  id: true, name: true, variant_name: true, sku: true, barcode: true, price: true, cost_price: true,
  quantity: true, low_stock_threshold: true, is_active: true, image_url: true, category_id: true,
}

// status: 'active' (default), 'inactive', or 'all'
const PRODUCT_SORTS = {
  name: (dir) => ({ name: dir }),
  sku: (dir) => ({ sku: dir }),
  category: (dir) => [{ category: { name: dir } }, { name: 'asc' }],
  price: (dir) => ({ price: dir }),
  cost_price: (dir) => ({ cost_price: { sort: dir, nulls: 'last' } }),
  quantity: (dir) => ({ quantity: dir }),
  is_active: (dir) => ({ is_active: dir }),
  created_at: (dir) => ({ created_at: dir }),
}

/**
 * With `group_variants`, only main products are listed, each with its active `variants`, so the
 * till can show one card per product and offer its sizes or flavours.
 */
async function listProducts({ page = 1, per_page = 20, search, category_id, status = 'active', group_variants = false, sort, order } = {}) {
  const skip = (page - 1) * per_page
  const take = Math.min(per_page, 100)

  const where = {}
  if (status === 'active') where.is_active = true
  if (status === 'inactive') where.is_active = false
  if (category_id) where.category_id = category_id
  if (group_variants) where.parent_id = null
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
        ...PRODUCT_INCLUDE,
        _count: { select: { variants: true } },
        ...(group_variants && {
          variants: { where: { is_active: true }, select: VARIANT_SELECT, orderBy: [{ variant_name: 'asc' }] },
        }),
      },
      orderBy: buildOrderBy({ sort, order }, PRODUCT_SORTS, { name: 'asc' }),
    }),
    prisma.product.count({ where }),
  ])

  return { products, total, page, per_page: take, total_pages: Math.ceil(total / take) }
}

async function getProductById(id) {
  const product = await prisma.product.findUnique({
    where: { id },
    include: { ...PRODUCT_INCLUDE, variants: { select: VARIANT_SELECT, orderBy: [{ variant_name: 'asc' }] } },
  })
  if (!product) throw new NotFoundError('Product not found')
  return product
}

async function getProductByBarcode(barcode) {
  const product = await prisma.product.findUnique({ where: { barcode }, include: PRODUCT_INCLUDE })
  if (!product) throw new NotFoundError('Product not found')
  if (!product.is_active) throw new NotFoundError('Product is inactive')
  return product
}

async function assertSupplierExists(supplierId) {
  if (!supplierId) return
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true } })
  if (!supplier) throw new ValidationError('Supplier not found', [{ field: 'supplier_id', message: 'Supplier does not exist' }])
}

function variantError(field, message) {
  return new ValidationError('Invalid variant', [{ field, message }])
}

/** Empty strings (e.g. from a form) mean no variant name. */
function cleanVariantName(value) {
  if (value === undefined) return undefined
  const name = typeof value === 'string' ? value.trim() : value
  return name || null
}

/**
 * Throws if `name` is already used by another option of the same product: the main product
 * (`familyId`) or any of its variants.
 */
async function assertVariantNameFree(familyId, name, selfId) {
  if (!name) return
  const clash = await prisma.product.findFirst({
    where: {
      OR: [{ id: familyId }, { parent_id: familyId }],
      variant_name: { equals: name, mode: 'insensitive' },
      ...(selfId && { NOT: { id: selfId } }),
    },
    select: { id: true },
  })
  if (clash) throw new ConflictError('This product already has an option with that name', 'variant_name')
}

/** Checks a new variant's main product and returns it. */
async function resolveParent(data) {
  const parent = await prisma.product.findUnique({ where: { id: data.parent_id } })
  if (!parent) throw variantError('parent_id', 'The main product does not exist')
  if (parent.parent_id) throw variantError('parent_id', 'A variant cannot have variants of its own; add it to the main product')
  if (!cleanVariantName(data.variant_name)) throw variantError('variant_name', 'Name the variant, e.g. a size or flavour')
  if (data.category_id !== parent.category_id) {
    throw variantError('category_id', 'A variant must be in the same category as its main product')
  }
  return parent
}

// Keeps a cost price of 0 instead of treating it as missing
function optionalCost(value) {
  return value === '' || value === null || value === undefined ? null : value
}

async function createProduct(data, userId) {
  // Check uniqueness
  const [existingSku, existingBarcode] = await Promise.all([
    prisma.product.findUnique({ where: { sku: data.sku } }),
    data.barcode ? prisma.product.findUnique({ where: { barcode: data.barcode } }) : null,
  ])

  if (existingSku) throw new ConflictError('SKU already exists', 'sku')
  if (existingBarcode) throw new ConflictError('Barcode already exists', 'barcode')

  const parent = data.parent_id ? await resolveParent(data) : null
  const variantName = cleanVariantName(data.variant_name) ?? null
  if (parent) await assertVariantNameFree(parent.id, variantName)

  // Check category and supplier exist
  const category = await prisma.category.findUnique({ where: { id: data.category_id } })
  if (!category) throw new NotFoundError('Category not found')
  await assertSupplierExists(data.supplier_id)

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
        cost_price: optionalCost(data.cost_price),
        quantity,
        low_stock_threshold: data.low_stock_threshold ?? 10,
        image_url: data.image_url || null,
        is_active: data.is_active ?? true,
        parent_id: parent?.id ?? null,
        variant_name: variantName,
      },
      include: PRODUCT_INCLUDE,
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
    if (conflict) throw new ConflictError('SKU already exists', 'sku')
  }
  if (data.barcode && data.barcode !== existing.barcode) {
    const conflict = await prisma.product.findUnique({ where: { barcode: data.barcode } })
    if (conflict) throw new ConflictError('Barcode already exists', 'barcode')
  }
  if (data.category_id) {
    const category = await prisma.category.findUnique({ where: { id: data.category_id } })
    if (!category) throw new NotFoundError('Category not found')
  }
  await assertSupplierExists(data.supplier_id)

  // Variants share their main product's category; moving the main product moves them too
  const categoryChanged = data.category_id !== undefined && data.category_id !== existing.category_id
  if (existing.parent_id && categoryChanged) {
    throw variantError('category_id', "A variant is always in its main product's category; change the main product instead")
  }
  const variantName = cleanVariantName(data.variant_name)
  if (variantName !== undefined) {
    if (existing.parent_id && !variantName) throw variantError('variant_name', 'Name the variant, e.g. a size or flavour')
    await assertVariantNameFree(existing.parent_id ?? existing.id, variantName, existing.id)
  }

  const [product] = await prisma.$transaction([
    prisma.product.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.sku !== undefined && { sku: data.sku }),
        ...(data.barcode !== undefined && { barcode: data.barcode || null }),
        ...(data.category_id !== undefined && { category_id: data.category_id }),
        ...(data.supplier_id !== undefined && { supplier_id: data.supplier_id || null }),
        ...(data.price !== undefined && { price: data.price }),
        ...(data.cost_price !== undefined && { cost_price: optionalCost(data.cost_price) }),
        // quantity is intentionally not editable here — stock changes go through inventory so they are logged
        ...(data.low_stock_threshold !== undefined && { low_stock_threshold: data.low_stock_threshold }),
        ...(data.image_url !== undefined && { image_url: data.image_url || null }),
        ...(data.is_active !== undefined && { is_active: data.is_active }),
        ...(variantName !== undefined && { variant_name: variantName }),
      },
      include: PRODUCT_INCLUDE,
    }),
    ...(categoryChanged && !existing.parent_id
      ? [prisma.product.updateMany({ where: { parent_id: id }, data: { category_id: data.category_id } })]
      : []),
  ])

  if (data.is_active !== undefined && data.is_active !== existing.is_active) {
    await recordAudit({
      userId: user?.id,
      action: data.is_active ? 'PRODUCT_REACTIVATED' : 'PRODUCT_DEACTIVATED',
      entity: 'Product',
      entityId: id,
      details: `${existing.name} (${existing.sku})`,
    })
  }

  return product
}

async function softDeleteProduct(id, userId) {
  const existing = await prisma.product.findUnique({ where: { id } })
  if (!existing) throw new NotFoundError('Product not found')

  await prisma.$transaction([
    prisma.product.update({ where: { id }, data: { is_active: false } }),
    prisma.auditLog.create({
      data: { user_id: userId, action: 'PRODUCT_DEACTIVATED', entity: 'Product', entity_id: id, details: `${existing.name} (${existing.sku})` },
    }),
  ])
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
  if (existing) throw new ConflictError('Category name already exists', 'name')

  return prisma.category.create({
    data: { name: data.name, description: data.description || null },
  })
}

async function updateCategory(id, data) {
  const existing = await prisma.category.findUnique({ where: { id } })
  if (!existing) throw new NotFoundError('Category not found')

  if (data.name && data.name !== existing.name) {
    const conflict = await prisma.category.findUnique({ where: { name: data.name } })
    if (conflict) throw new ConflictError('Category name already exists', 'name')
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
  PRODUCT_SORTS,
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
