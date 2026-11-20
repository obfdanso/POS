import { describe, it, expect, vi } from 'vitest'
import { initErrorReporting, reportError, scrubEvent } from '../utils/errorReporting'

describe('client error reporting', () => {
  it('stays off without a DSN and reporting is then a no-op', async () => {
    expect(await initErrorReporting('')).toBe(false)
    expect(() => reportError(new Error('boom'))).not.toThrow()
  })

  it('strips URL queries, breadcrumbs, cookies and headers', () => {
    const event = scrubEvent({
      breadcrumbs: [{ category: 'console', message: 'kofi@example.com' }],
      request: { url: 'https://pos.example.com/customers?search=024', query_string: 'search=024', cookies: { a: 1 }, headers: { Referer: 'x' } },
    })
    expect(event).toEqual({ request: { url: 'https://pos.example.com/customers' } })
  })

  it('loads Sentry and reports errors once a DSN is given', async () => {
    const captureException = vi.fn()
    vi.doMock('@sentry/react', () => ({
      init: vi.fn(),
      captureException,
      setUser: vi.fn(),
      withScope: (fn: (scope: { setContext: () => void }) => void) => fn({ setContext: vi.fn() }),
    }))
    vi.resetModules()
    const fresh = await import('../utils/errorReporting')
    expect(await fresh.initErrorReporting('https://public@example.ingest.sentry.io/1')).toBe(true)
    const err = new Error('render failed')
    fresh.reportError(err, { componentStack: 'at POSPage' })
    expect(captureException).toHaveBeenCalledWith(err)
  })
})
