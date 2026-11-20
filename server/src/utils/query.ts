/**
 * Readers for `req.query` values, which Express types as string | string[] | object. The routes
 * validate the params they use, so a validated param is a single string or absent.
 */

/** A query param as a string, or undefined when it is absent (or not a single value). */
export function queryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** `parseInt` of a query param, exactly as the JS controllers did it (NaN when absent). */
export function queryInt(value: unknown): number {
  return parseInt(String(value))
}
