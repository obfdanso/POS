import type { MoneyLike } from '../types'

let defaultSymbol = 'GH₵'

/**
 * Set the symbol used when formatCurrency is called without one.
 * SettingsContext calls this whenever the store's currency setting loads or changes.
 */
export function setDefaultCurrencySymbol(symbol: string | null | undefined): void {
  if (symbol) defaultSymbol = symbol
}

/**
 * Format a number as currency, e.g. "GH₵ 1,234.56".
 * @param amount - A number or an API decimal string; anything unparseable shows as 0.00
 * @param symbol - Currency symbol (defaults to the configured store symbol)
 */
export function formatCurrency(amount: MoneyLike | null | undefined, symbol: string = defaultSymbol): string {
  const num = parseFloat(String(amount))
  if (isNaN(num)) return `${symbol} 0.00`
  return `${symbol} ${num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
