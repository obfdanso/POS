let defaultSymbol = 'GH₵'

/**
 * Set the symbol used when formatCurrency is called without one.
 * SettingsContext calls this whenever the store's currency setting loads or changes.
 * @param {string} symbol
 */
export function setDefaultCurrencySymbol(symbol) {
  if (symbol) defaultSymbol = symbol
}

/**
 * Format a number as currency, e.g. "GH₵ 1,234.56".
 * @param {number|string} amount
 * @param {string} [symbol] - Currency symbol (defaults to the configured store symbol)
 * @returns {string}
 */
export function formatCurrency(amount, symbol = defaultSymbol) {
  const num = parseFloat(amount)
  if (isNaN(num)) return `${symbol} 0.00`
  return `${symbol} ${num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
