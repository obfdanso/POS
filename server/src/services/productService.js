const prisma = require('../utils/prismaClient')
const { buildOrderBy } = require('../middleware/sorting')
const { recordAudit } = require('../utils/audit')
const { NotFoundError, ConflictError, ForbiddenError, ValidationError } = require('../utils/errors')
const { changeStock, branchStockFor, withStock } = require('../utils/branchStock')

const PARENT = { select: { id: true, name: true, variant_name: true } }
const PRODUCT_INCLUDE = {
  category: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  parent: PARENT,
}
// What a product page or the till needs to know about each variant (stock is added per branch)
const VARIANT_SELECT = {
  id: true, name: true, variant_name: true, sku: true, barcode: true, price: true, cost_price: true,
  is_active: true, image_url: true, category_id: true,
}
const STOCKS_INCLUDE = {
  stocks: {
    select: { branch_id: true, quantity: true, low_stock_threshold: true, branch: { select: { name: true, code: true } } },
    orderBy: { branch: { name: 'asc' } },
  },
}
const stockedAt = (branchId) => (branchId ? { stocks: { some: { branch_id: branchId } } } : {})

/** Attach the acting branch's (or all branches') stock to products and their variants. */
async function attachStock(products, branchId) {
  const ids = products.flatMap((p) => [p.id, ...(p.variants || []).map((v) => v.id)])
  const stock = await branchStockFor(ids, branchId)
  return products.map((p) => withStock(p, stock))
}

// status: 'active' (default), 'inactive', or 'all'
const PRODUCT_SORTS = {
  name: (dir) => ({ name: dir }),
  sku: (dir) => ({ sku: dir }),
  category: (dir) => [{ category: { name: dir } }, { name: 'asc' }],
  price: (dir) => ({ price: dir }),
  cost_price: (dir) => ({ cost_price: { sort: dir, nulls: 'last' } }),
  // Stock lives per branch, so listProducts sorts by it separately
  quantity: null,
  is_active: (dir) => ({ is_active: dir }),
  created_at: (dir) => ({ created_at: dir }),
}

/**
 * With `group_variants`, only main products are listed, each with its active `variants`, so the
 * till can show one card per product and offer its sizes or flavours.
 * With a `branchId`, only products that branch stocks are listed, with its quantities; without one
 * (an admin viewing all branches) every product is listed with quantities summed across branches.
 */
async function listProducts({ page = 1, per_page = 20, search, category_id, status = 'active', group_variants = false, sort, order, branchId = null } = {}) {
  const skip = (page - 1) * per_page
  const take = Math.min(per_page, 100)

  const where = {}
  if (status === 'active') where.is_active = true
  if (status === 'inactive') where.is_active = false
  if (category_id) where.category_id = category_id
  // Variants of a deactivated main product stand on their own, so they stay on the till
  if (group_variants) where.OR = [{ parent_id: null }, { parent: { is_active: false } }]
  if (search) {
    where.AND = [{ OR: [...(where.OR || [])] }].filter((c) => c.OR.length)
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { barcode: { contains: search, mode: 'insensitive' } },
    ]
  }
  Object.assign(where, stockedAt(branchId))

  const include = {
    ...PRODUCT_INCLUDE,
    _count: { select: { variants: true } },
    ...(group_variants && {
      variants: { where: { is_active: true, ...stockedAt(branchId) }, select: VARIANT_SELECT, orderBy: [{ variant_name: 'asc' }] },
    }),
  }

  let products
  const total = await prisma.product.count({ where })
  if (sort === 'quantity') {
    // Order by the branch's stock (or the chain's total), then load that page of products
    const groups = await prisma.branchStock.groupBy({
      by: ['product_id'],
      where: { ...(branchId && { branch_id: branchId }), product: where },
      _sum: { quantity: true },
      orderBy: [{ _sum: { quantity: order === 'desc' ? 'desc' : 'asc' } }, { product_id: 'asc' }],
      skip,
      take,
    })
    const found = await prisma.product.findMany({ where: { id: { in: groups.map((g) => g.product_id) } }, include })
    const byId = new Map(found.map((p) => [p.id, p]))
    products = groups.map((g) => byId.get(g.product_id)).filter(Boolean)
  } else {
    products = await prisma.product.findMany({
      where,
      skip,
      take,
      include,
      orderBy: buildOrderBy({ sort, order }, PRODUCT_SORTS, { name: 'asc' }),
    })
  }

  return { products: await attachStock(products, branchId), total, page, per_page: take, total_pages: Math.ceil(total / take) }
}

/**
 * A product with every branch's stock (`stocks`) and the acting branch's `quantity`. A branch that
 * doesn't stock it still gets it (with `stocked: false`) so a manager can start stocking it.
 */
async function getProductById(id, branchId = null) {
  const product = await prisma.product.findUnique({
    where: { id },
    include: { ...PRODUCT_INCLUDE, ...STOCKS_INCLUDE, variants: { select: VARIANT_SELECT, orderBy: [{ variant_name: 'asc' }] } },
  })
  if (!product) throw new NotFoundError('Product not found')
  return (await attachStock([product], branchId))[0]
}

async function getProductByBarcode(barcode, branchId = null) {
  const product = await prisma.product.findUnique({ where: { barcode }, include: PRODUCT_INCLUDE })
  if (!product) throw new NotFoundError('Product not found')
  if (!product.is_active) throw new NotFoundError('Product is inactive')
  const [withQty] = await attachStock([product], branchId)
  if (branchId && !withQty.stocked) throw new NotFoundError('Not stocked at this branch')
  return withQty
}

const stocksError = (message) => new ValidationError('Invalid branch stock', [{ field: 'stocks', message }])

/**
 * Which branches a create or update may touch: an admin any open branch, a manager only their own.
 * Returns the open branches by id (for names in messages).
 */
async function checkStockBranches(stocks, user) {
  const open = await prisma.branch.findMany({ where: { is_active: true }, select: { id: true, name: true } })
  const byId = new Map(open.map((b) => [b.id, b]))
  const seen = new Set()
  for (const s of stocks) {
    if (user.role !== 'ADMIN' && s.branch_id !== user.branch_id) {
      throw new ForbiddenError("You can only manage your own branch's stock")
    }
    if (!byId.has(s.branch_id)) throw stocksError('One of the branches does not exist or is closed')
    if (seen.has(s.branch_id)) throw stocksError('Each branch can only be listed once')
    seen.add(s.branch_id)
  }
  return byId
}

/** Start stocking a product at a branch, logging any starting quantity. */
async function addStockRow(tx, productId, row, userId) {
  await tx.branchStock.create({
    data: { branch_id: row.branch_id, product_id: productId, low_stock_threshold: row.low_stock_threshold ?? 10 },
  })
  if (row.quantity > 0) {
    await changeStock(tx, { branchId: row.branch_id, productId, change: row.quantity, type: 'RESTOCK', userId, notes: 'Starting stock' })
  }
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

/**
 * `stocks` lists the branches that will stock the product, each with an optional starting
 * `quantity` and `low_stock_threshold`. Left out, an admin's product goes to every open branch and
 * a manager's to their own; a top-level `quantity`/`low_stock_threshold` then applies to the
 * acting branch.
 */
async function createProduct(data, user, branchId = null) {
  const userId = user.id
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

  let stocks = data.stocks
  if (!stocks) {
    const targets = user.role === 'ADMIN'
      ? (await prisma.branch.findMany({ where: { is_active: true }, select: { id: true } })).map((b) => b.id)
      : [user.branch_id]
    stocks = targets.map((id) => ({
      branch_id: id,
      ...(id === branchId && { quantity: data.quantity ?? 0, low_stock_threshold: data.low_stock_threshold }),
    }))
  }
  await checkStockBranches(stocks, user)

  // Create the product and its stock rows, logging starting stock, together
  const created = await prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        name: data.name,
        sku: data.sku,
        barcode: data.barcode || null,
        category_id: data.category_id,
        supplier_id: data.supplier_id || null,
        price: data.price,
        cost_price: optionalCost(data.cost_price),
        image_url: data.image_url || null,
        is_active: data.is_active ?? true,
        parent_id: parent?.id ?? null,
        variant_name: variantName,
      },
      include: PRODUCT_INCLUDE,
    })
    for (const row of stocks) await addStockRow(tx, product.id, row, userId)
    return product
  })
  return getProductById(created.id, branchId)
}

/**
 * `stocks`, when sent, is the full list of branches that should stock the product (a manager's list
 * only covers their own branch): new branches are added with their starting quantity, listed ones get
 * their low-stock level updated, and branches left out stop stocking it if they hold none.
 * A top-level `low_stock_threshold` sets the acting branch's level.
 */
async function updateProduct(id, data, user, branchId = null) {
  const existing = await prisma.product.findUnique({ where: { id }, include: { stocks: true } })
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

  const branches = data.stocks ? await checkStockBranches(data.stocks, user) : null
  const inScope = existing.stocks.filter((s) => user.role === 'ADMIN' || s.branch_id === user.branch_id)
  if (data.stocks) {
    const keep = new Set(data.stocks.map((s) => s.branch_id))
    for (const row of inScope.filter((s) => !keep.has(s.branch_id) && s.quantity > 0)) {
      const name = branches.get(row.branch_id)?.name
        ?? (await prisma.branch.findUnique({ where: { id: row.branch_id }, select: { name: true } })).name
      throw stocksError(`"${name}" still has ${row.quantity} in stock`)
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.product.update({
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
        ...(data.image_url !== undefined && { image_url: data.image_url || null }),
        ...(data.is_active !== undefined && { is_active: data.is_active }),
        ...(variantName !== undefined && { variant_name: variantName }),
      },
    })
    if (categoryChanged && !existing.parent_id) {
      await tx.product.updateMany({ where: { parent_id: id }, data: { category_id: data.category_id } })
    }
    if (data.low_stock_threshold !== undefined && branchId) {
      await tx.branchStock.updateMany({ where: { product_id: id, branch_id: branchId }, data: { low_stock_threshold: data.low_stock_threshold } })
    }
    if (data.stocks) {
      const current = new Map(existing.stocks.map((s) => [s.branch_id, s]))
      for (const row of data.stocks) {
        if (!current.has(row.branch_id)) await addStockRow(tx, id, row, user.id)
        else if (row.low_stock_threshold !== undefined) {
          await tx.branchStock.update({
            where: { branch_id_product_id: { branch_id: row.branch_id, product_id: id } },
            data: { low_stock_threshold: row.low_stock_threshold },
          })
        }
      }
      const keep = new Set(data.stocks.map((s) => s.branch_id))
      const drop = inScope.filter((s) => !keep.has(s.branch_id)).map((s) => s.id)
      // Only empty rows reach here; the guard keeps a sale racing this from losing stock
      if (drop.length) await tx.branchStock.deleteMany({ where: { id: { in: drop }, quantity: 0 } })
    }
  })

  if (data.is_active !== undefined && data.is_active !== existing.is_active) {
    await recordAudit({
      userId: user?.id,
      action: data.is_active ? 'PRODUCT_REACTIVATED' : 'PRODUCT_DEACTIVATED',
      entity: 'Product',
      entityId: id,
      details: `${existing.name} (${existing.sku})`,
    })
  }

  return getProductById(id, branchId)
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
