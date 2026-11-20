const prisma = require('../utils/prismaClient').default
const { NotFoundError, ValidationError } = require('../utils/errors')
const { recordAudit } = require('../utils/audit')

const PROMO_INCLUDE = {
  product: { select: { id: true, name: true, sku: true } },
  category: { select: { id: true, name: true } },
}

/** Running now: switched on, started, and not yet ended. */
function activeWhere(now = new Date()) {
  return { is_active: true, starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] }
}

/** Where a promotion stands at `now`, for lists and badges. */
function promotionState(promo, now = new Date()) {
  if (!promo.is_active) return 'OFF'
  if (new Date(promo.starts_at) > now) return 'SCHEDULED'
  if (promo.ends_at && new Date(promo.ends_at) <= now) return 'ENDED'
  return 'ACTIVE'
}

const SPECIFICITY = (p) => (p.product_id ? 2 : p.category_id ? 1 : 0)

/**
 * The promotion for one product among running ones: the biggest percentage off; on a tie the most
 * specific (product, then category, then storewide). The till uses the same rule (client/src/utils/saleTotals.js).
 */
function bestPromotionFor(product, promotions) {
  let best = null
  for (const p of promotions) {
    const applies = p.product_id ? p.product_id === product.id : p.category_id ? p.category_id === product.category_id : true
    if (!applies) continue
    const pct = Number(p.percent_off)
    const bestPct = best ? Number(best.percent_off) : -1
    if (pct > bestPct || (pct === bestPct && SPECIFICITY(p) > SPECIFICITY(best))) best = p
  }
  return best
}

/** Running promotions that could apply to any of these products. */
async function activePromotionsFor(products, db = prisma) {
  if (products.length === 0) return []
  return db.promotion.findMany({
    where: {
      ...activeWhere(),
      AND: [
        {
          OR: [
            { product_id: { in: products.map((p) => p.id) } },
            { category_id: { in: [...new Set(products.map((p) => p.category_id))] } },
            { product_id: null, category_id: null },
          ],
        },
      ],
    },
    select: { id: true, name: true, percent_off: true, product_id: true, category_id: true },
  })
}

/** Every running promotion, for the till to price the cart exactly as the server will. */
async function listActivePromotions() {
  const rows = await prisma.promotion.findMany({
    where: activeWhere(),
    select: { id: true, name: true, percent_off: true, product_id: true, category_id: true, ends_at: true },
    orderBy: { percent_off: 'desc' },
  })
  return rows.map((r) => ({ ...r, percent_off: Number(r.percent_off) }))
}

async function listPromotions({ status } = {}) {
  const now = new Date()
  const rows = await prisma.promotion.findMany({
    include: { ...PROMO_INCLUDE, _count: { select: { sale_items: true } } },
    orderBy: [{ is_active: 'desc' }, { starts_at: 'desc' }],
  })
  return rows
    .map(({ _count, ...p }) => ({ ...p, status: promotionState(p, now), times_used: _count.sale_items }))
    .filter((p) => !status || p.status === status)
}

async function getPromotion(id) {
  const promo = await prisma.promotion.findUnique({ where: { id }, include: PROMO_INCLUDE })
  if (!promo) throw new NotFoundError('Promotion not found')
  return { ...promo, status: promotionState(promo) }
}

async function checkTarget({ product_id, category_id }) {
  if (product_id && category_id) {
    throw new ValidationError('Choose one target', [{ field: 'category_id', message: 'A promotion applies to a product or a category, not both' }])
  }
  if (product_id && !(await prisma.product.findUnique({ where: { id: product_id }, select: { id: true } }))) {
    throw new ValidationError('Product not found', [{ field: 'product_id', message: 'Product does not exist' }])
  }
  if (category_id && !(await prisma.category.findUnique({ where: { id: category_id }, select: { id: true } }))) {
    throw new ValidationError('Category not found', [{ field: 'category_id', message: 'Category does not exist' }])
  }
}

function checkDates(startsAt, endsAt) {
  if (endsAt && new Date(endsAt) <= new Date(startsAt)) {
    throw new ValidationError('Invalid dates', [{ field: 'ends_at', message: 'The end must be after the start' }])
  }
}

async function createPromotion(data, userId) {
  await checkTarget(data)
  const startsAt = data.starts_at ? new Date(data.starts_at) : new Date()
  checkDates(startsAt, data.ends_at)
  const promo = await prisma.promotion.create({
    data: {
      name: data.name,
      percent_off: data.percent_off,
      product_id: data.product_id || null,
      category_id: data.category_id || null,
      starts_at: startsAt,
      ends_at: data.ends_at ? new Date(data.ends_at) : null,
      is_active: data.is_active ?? true,
    },
    include: PROMO_INCLUDE,
  })
  await recordAudit({ userId, action: 'PROMOTION_CREATED', entity: 'Promotion', entityId: promo.id, details: `${promo.name}: ${promo.percent_off}% off` })
  return { ...promo, status: promotionState(promo) }
}

async function updatePromotion(id, data, userId) {
  const existing = await prisma.promotion.findUnique({ where: { id } })
  if (!existing) throw new NotFoundError('Promotion not found')
  const merged = {
    product_id: data.product_id !== undefined ? data.product_id : existing.product_id,
    category_id: data.category_id !== undefined ? data.category_id : existing.category_id,
  }
  await checkTarget(merged)
  const startsAt = data.starts_at !== undefined ? new Date(data.starts_at) : existing.starts_at
  const endsAt = data.ends_at !== undefined ? data.ends_at : existing.ends_at
  checkDates(startsAt, endsAt)

  const promo = await prisma.promotion.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.percent_off !== undefined && { percent_off: data.percent_off }),
      product_id: merged.product_id || null,
      category_id: merged.category_id || null,
      starts_at: startsAt,
      ends_at: endsAt ? new Date(endsAt) : null,
      ...(data.is_active !== undefined && { is_active: data.is_active }),
    },
    include: PROMO_INCLUDE,
  })
  await recordAudit({
    userId,
    action: 'PROMOTION_UPDATED',
    entity: 'Promotion',
    entityId: id,
    details: `${promo.name}: ${Object.keys(data).join(', ')}`,
  })
  return { ...promo, status: promotionState(promo) }
}

module.exports = {
  activeWhere,
  promotionState,
  bestPromotionFor,
  activePromotionsFor,
  listActivePromotions,
  listPromotions,
  getPromotion,
  createPromotion,
  updatePromotion,
}
