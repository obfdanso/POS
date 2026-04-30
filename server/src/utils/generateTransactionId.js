function generateTransactionId() {
  const date = new Date()
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `TXN-${dateStr}-${randomSuffix}`
}

module.exports = generateTransactionId
