import * as Sentry from '@sentry/node'
import type { ErrorEvent, EventHint } from '@sentry/node'
import type { Request } from 'express'

// Never send credentials, cookies, request bodies (which can hold passwords), query strings (customer
// searches), or log breadcrumbs to Sentry. Database errors can quote the values of the failed query,
// so their message is replaced with the error's name and code.
const SENSITIVE_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-paystack-signature']

interface DatabaseError {
  constructor?: { name?: string }
  code?: unknown
}

function isDatabaseError(err: unknown): err is DatabaseError {
  if (!err || typeof err !== 'object') return false
  const code = 'code' in err ? err.code : undefined
  const message = 'message' in err ? err.message : undefined
  return /^Prisma/.test(err.constructor?.name ?? '') || /^P\d{4}$/.test(String(code ?? '')) || /invocation/.test(String(message ?? ''))
}

export function scrubEvent(event: ErrorEvent, hint: EventHint = {}): ErrorEvent {
  delete event.breadcrumbs
  const original = hint.originalException
  if (isDatabaseError(original) && event.exception?.values) {
    const summary = [original.constructor?.name, original.code].filter(Boolean).join(' ') || 'Database error'
    for (const value of event.exception.values) value.value = summary
  }
  if (event.request) {
    delete event.request.cookies
    delete event.request.data
    delete event.request.query_string
    if (event.request.url) event.request.url = event.request.url.split('?')[0]
    if (event.request.headers) {
      for (const name of Object.keys(event.request.headers)) {
        if (SENSITIVE_HEADERS.includes(name.toLowerCase())) delete event.request.headers[name]
      }
    }
  }
  return event
}

let enabled = false

/** Starts error reporting when SENTRY_DSN is set; otherwise every call here does nothing. */
export function initErrorReporting(): boolean {
  if (!process.env.SENTRY_DSN || enabled) return enabled
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  })
  enabled = true
  return enabled
}

/** Reports an unexpected (500) error, tagged with its request ID so it matches the logs. */
export function reportError(err: unknown, req?: Request): void {
  if (!enabled) return
  Sentry.withScope((scope) => {
    if (req?.id) scope.setTag('request_id', req.id)
    if (req?.user) scope.setUser({ id: req.user.id, role: req.user.role })
    if (req?.method) scope.setContext('route', { method: req.method, path: req.originalUrl?.split('?')[0] })
    Sentry.captureException(err)
  })
}
