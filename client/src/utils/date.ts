/**
 * Format a date as YYYY-MM-DD in the browser's local time zone.
 * (Date#toISOString converts to UTC first, which shifts the day outside UTC+0.)
 */
export function toISODate(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * The local date `days` days from today (negative for the past), as YYYY-MM-DD.
 */
export function daysFromToday(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toISODate(date)
}
