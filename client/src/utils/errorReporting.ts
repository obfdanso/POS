// Optional browser error reporting to Sentry. The SDK is downloaded only when VITE_SENTRY_DSN is
// set at build time, so the app is no bigger when reporting is off.
import type { Role } from '../types'

type SentrySdk = typeof import('@sentry/react')

let sentry: SentrySdk | null = null

/** The parts of a Sentry event that scrubEvent removes or trims */
interface ScrubbableEvent {
  breadcrumbs?: unknown
  request?: { url?: string; query_string?: unknown; cookies?: unknown; headers?: unknown }
}

// Strip things that could identify customers or carry credentials: URL queries and breadcrumbs
// (which record clicks, console output and request URLs)
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  delete event.breadcrumbs
  if (event.request?.url) event.request.url = event.request.url.split('?')[0]
  if (event.request) {
    delete event.request.query_string
    delete event.request.cookies
    delete event.request.headers
  }
  return event
}

export async function initErrorReporting(dsn: string | undefined = import.meta.env.VITE_SENTRY_DSN): Promise<boolean> {
  if (!dsn || sentry) return false
  const Sentry = await import('@sentry/react')
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  })
  sentry = Sentry
  return true
}

/** Reports an error the app caught (e.g. in the error boundary); does nothing when reporting is off. */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!sentry) return
  const sdk = sentry
  sdk.withScope((scope) => {
    if (context) scope.setContext('react', context)
    sdk.captureException(error)
  })
}

/** Records who is signed in (ID and role only) so reports show which kind of user hit them. */
export function setReportingUser(user: { id: string; role?: Role } | null): void {
  sentry?.setUser(user ? { id: user.id, role: user.role } : null)
}
