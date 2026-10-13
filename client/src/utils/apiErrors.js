/**
 * Field-level errors from an API error response, as { field: message } for inline form errors.
 * @param {unknown} err - Error thrown by axios
 * @returns {Record<string, string>}
 */
export function getFieldErrors(err) {
  const details = err?.response?.data?.error?.details ?? []
  return Object.fromEntries(details.filter((d) => d.field).map((d) => [d.field, d.message]))
}

/**
 * Human-readable message from an API error response.
 * @param {unknown} err - Error thrown by axios
 * @param {string} fallback - Message to use when the response has none
 * @returns {string}
 */
export function getErrorMessage(err, fallback) {
  return err?.response?.data?.error?.message ?? fallback
}
