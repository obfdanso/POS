/**
 * Build a human-readable transaction ID in the format TXN-YYYYMMDD-NNNN,
 * where NNNN is the sale's sequence number for that day (1-based).
 * @param {Date} date - Date of the sale (local time)
 * @param {number} sequence - The sale's position within the day
 * @returns {string} e.g. "TXN-20260319-0001"
 */
function generateTransactionId(date, sequence) {
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  return `TXN-${dateStr}-${String(sequence).padStart(4, '0')}`
}

module.exports = generateTransactionId
