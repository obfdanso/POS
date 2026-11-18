const Sentry = require('@sentry/node')

// Never send credentials, cookies, or request bodies (which can hold passwords) to Sentry
const SENSITIVE_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-paystack-signature']

function scrubEvent(event) {
  if (event.request) {
    delete event.request.cookies
    delete event.request.data
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
function initErrorReporting() {
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
function reportError(err, req) {
  if (!enabled) return
  Sentry.withScope((scope) => {
    if (req?.id) scope.setTag('request_id', req.id)
    if (req?.user) scope.setUser({ id: req.user.id, role: req.user.role })
    if (req?.method) scope.setContext('route', { method: req.method, path: req.originalUrl?.split('?')[0] })
    Sentry.captureException(err)
  })
}

module.exports = { initErrorReporting, reportError, scrubEvent }
