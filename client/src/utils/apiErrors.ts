import type { ApiErrorBody } from '../types'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The HTTP status of a failed axios request, if the server answered. */
export function errorStatus(err: unknown): number | undefined {
  if (!isRecord(err) || !isRecord(err.response)) return undefined
  return typeof err.response.status === 'number' ? err.response.status : undefined
}

/** The `error` object of an API error response (see docs/API.md), if the error carries one. */
export function apiErrorBody(err: unknown): Partial<ApiErrorBody> | undefined {
  if (!isRecord(err) || !isRecord(err.response) || !isRecord(err.response.data)) return undefined
  const { error } = err.response.data
  // The server's error envelope: { code, message, details?, request_id? }
  return isRecord(error) ? (error as Partial<ApiErrorBody>) : undefined
}

/**
 * Field-level errors from an API error response, as { field: message } for inline form errors.
 * @param err - Error thrown by axios
 */
export function getFieldErrors(err: unknown): Record<string, string> {
  const details = apiErrorBody(err)?.details ?? []
  return Object.fromEntries(details.filter((d) => d.field).map((d) => [d.field, d.message]))
}

/**
 * Human-readable message from an API error response.
 * @param err - Error thrown by axios
 * @param fallback - Message to use when the response has none
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  const error = apiErrorBody(err)
  const message = error?.message ?? fallback
  // Unexpected server errors carry a request ID that matches the server log entry
  return error?.request_id ? `${message} (ref ${String(error.request_id).slice(0, 8)})` : message
}
