/**
 * Parse a YYYY-MM-DD string as local midnight. `new Date('2026-03-19')` would
 * give UTC midnight instead, which disagrees with local end-of-day bounds.
 * Full timestamps are passed through to the Date constructor unchanged.
 */
export function parseLocalDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return new Date(value)
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

export interface DateRange {
  gte?: Date
  lte?: Date
}

/** Inclusive created_at range: start of start_date to end of end_date (local time). */
export function buildDateRange(start_date?: string, end_date?: string): DateRange {
  const range: DateRange = {}
  if (start_date) range.gte = parseLocalDate(start_date)
  if (end_date) {
    const end = parseLocalDate(end_date)
    end.setHours(23, 59, 59, 999)
    range.lte = end
  }
  return range
}
