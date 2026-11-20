import { query } from 'express-validator'

export type SortDirection = 'asc' | 'desc'

/**
 * Validation rules for ?sort=<field>&order=asc|desc on a list endpoint.
 * @param fields - Sortable field names the endpoint accepts
 */
export function sortRules(fields: string[]) {
  return [
    query('sort').optional().isIn(fields).withMessage(`sort must be one of: ${fields.join(', ')}`),
    query('order').optional().isIn(['asc', 'desc']).withMessage('order must be asc or desc'),
  ]
}

/**
 * Build a Prisma orderBy from validated sort params.
 * @param fields - Maps each sortable field to its orderBy
 *   (an array adds secondary orderings, e.g. category then name)
 * @param fallback - orderBy to use when no sort is requested
 * @returns orderBy list, with `id` as a tie-breaker so pagination is stable
 */
export function buildOrderBy<T extends object>(
  { sort, order }: { sort?: string; order?: string },
  fields: Record<string, (dir: SortDirection) => T | T[]>,
  fallback: T | T[]
): (T | { id: 'asc' })[] {
  const dir = order === 'desc' ? 'desc' : 'asc'
  const primary = sort && fields[sort] ? fields[sort](dir) : fallback
  const orderBy: (T | { id: 'asc' })[] = []
  return orderBy.concat(primary, { id: 'asc' })
}
