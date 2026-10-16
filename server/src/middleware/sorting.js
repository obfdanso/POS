const { query } = require('express-validator')

/**
 * Validation rules for ?sort=<field>&order=asc|desc on a list endpoint.
 * @param {string[]} fields - Sortable field names the endpoint accepts
 */
function sortRules(fields) {
  return [
    query('sort').optional().isIn(fields).withMessage(`sort must be one of: ${fields.join(', ')}`),
    query('order').optional().isIn(['asc', 'desc']).withMessage('order must be asc or desc'),
  ]
}

/**
 * Build a Prisma orderBy from validated sort params.
 * @param {{ sort?: string, order?: string }} params
 * @param {Record<string, (dir: 'asc'|'desc') => object|object[]>} fields - Maps each sortable field to its orderBy
 *   (an array adds secondary orderings, e.g. category then name)
 * @param {object} fallback - orderBy to use when no sort is requested
 * @returns {object[]} orderBy list, with `id` as a tie-breaker so pagination is stable
 */
function buildOrderBy({ sort, order }, fields, fallback) {
  const dir = order === 'desc' ? 'desc' : 'asc'
  const primary = sort && fields[sort] ? fields[sort](dir) : fallback
  return [].concat(primary, { id: 'asc' })
}

module.exports = { sortRules, buildOrderBy }
