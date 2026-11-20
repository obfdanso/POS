jest.mock('@sentry/node', () => {
  const scope = { setTag: jest.fn(), setUser: jest.fn(), setContext: jest.fn() }
  return { init: jest.fn(), captureException: jest.fn(), withScope: jest.fn((fn) => fn(scope)), scope }
})
import * as Sentry from '@sentry/node'
import type { ErrorEvent } from '@sentry/node'
import type { Request, Response } from 'express'

type ErrorReporting = typeof import('../utils/errorReporting')

// The mocked scope that withScope hands to its callback
const scope = jest.requireMock<{ scope: { setTag: jest.Mock; setUser: jest.Mock; setContext: jest.Mock } }>('@sentry/node').scope
// A stand-in for the Express request the reporter reads
const fakeRequest = (fields: Record<string, unknown>) => fields as Partial<Request> as Request
// Event payloads as Sentry would pass them to beforeSend
const errorEvent = (fields: Omit<ErrorEvent, 'type'>) => fields as ErrorEvent

const loadFresh = () => {
  let mod: ErrorReporting | undefined
  jest.isolateModules(() => {
    mod = jest.requireActual<ErrorReporting>('../utils/errorReporting')
  })
  return mod as ErrorReporting
}

afterEach(() => {
  delete process.env.SENTRY_DSN
  jest.clearAllMocks()
})

describe('error reporting', () => {
  it('stays off and sends nothing without SENTRY_DSN', () => {
    const { initErrorReporting, reportError } = loadFresh()
    expect(initErrorReporting()).toBe(false)
    reportError(new Error('boom'), fakeRequest({ id: 'req-1' }))
    expect(Sentry.init).not.toHaveBeenCalled()
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('reports errors tagged with the request ID and user, but no personal details', () => {
    process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/1'
    const { initErrorReporting, reportError } = loadFresh()
    expect(initErrorReporting()).toBe(true)
    expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({ sendDefaultPii: false }))
    const err = new Error('boom')
    reportError(err, fakeRequest({ id: 'req-1', method: 'POST', originalUrl: '/api/sales?x=1', user: { id: 'u1', role: 'CASHIER', email: 'x@y.z' } }))
    expect(Sentry.captureException).toHaveBeenCalledWith(err)
    expect(scope.setTag).toHaveBeenCalledWith('request_id', 'req-1')
    expect(scope.setUser).toHaveBeenCalledWith({ id: 'u1', role: 'CASHIER' })
    expect(scope.setContext).toHaveBeenCalledWith('route', { method: 'POST', path: '/api/sales' })
  })

  it('strips tokens, cookies and request bodies before sending', () => {
    const { scrubEvent } = loadFresh()
    const event = scrubEvent(errorEvent({
      request: {
        cookies: { refreshToken: 'secret' },
        data: '{"password":"admin123"}',
        headers: { Authorization: 'Bearer abc', Cookie: 'refreshToken=secret', 'user-agent': 'Chrome' },
      },
    }))
    expect(event.request).toEqual({ headers: { 'user-agent': 'Chrome' } })
  })

  it('drops query strings and breadcrumbs, which can hold customer searches and log text', () => {
    const { scrubEvent } = loadFresh()
    const event = scrubEvent(errorEvent({
      breadcrumbs: [{ message: 'login for kofi@example.com' }],
      request: { url: 'https://pos.example.com/api/customers?search=0241234567', query_string: 'search=0241234567' },
    }))
    expect(event.breadcrumbs).toBeUndefined()
    expect(event.request).toEqual({ url: 'https://pos.example.com/api/customers' })
  })

  it('replaces database error messages, which can quote query values, with the error code', () => {
    const { scrubEvent } = loadFresh()
    class PrismaClientKnownRequestError extends Error {}
    const dbError = Object.assign(new PrismaClientKnownRequestError('Invalid `prisma.customer.create()` invocation: email "kofi@example.com"'), { code: 'P2002' })
    const event = scrubEvent(errorEvent({ exception: { values: [{ type: 'PrismaClientKnownRequestError', value: dbError.message }] } }), { originalException: dbError })
    expect(event.exception?.values?.[0]?.value).toBe('PrismaClientKnownRequestError P2002')

    const plain = scrubEvent(errorEvent({ exception: { values: [{ type: 'TypeError', value: 'x is undefined' }] } }), { originalException: new TypeError('x is undefined') })
    expect(plain.exception?.values?.[0]?.value).toBe('x is undefined')
  })
})

describe('error handler', () => {
  it('reports unexpected errors but not expected ones like validation failures', () => {
    process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/1'
    let errorHandler: typeof import('../middleware/errorHandler').default | undefined
    let ValidationError: typeof import('../utils/errors').ValidationError | undefined
    jest.isolateModules(() => {
      jest.requireActual<ErrorReporting>('../utils/errorReporting').initErrorReporting()
      errorHandler = jest.requireActual<typeof import('../middleware/errorHandler')>('../middleware/errorHandler').default
      ValidationError = jest.requireActual<typeof import('../utils/errors')>('../utils/errors').ValidationError
    })
    if (!errorHandler || !ValidationError) throw new Error('modules did not load')
    const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() }) as Partial<Response> as Response
    errorHandler(new ValidationError('Bad input'), fakeRequest({ id: 'r1' }), res(), () => {})
    expect(Sentry.captureException).not.toHaveBeenCalled()
    errorHandler(new Error('db exploded'), fakeRequest({ id: 'r2' }), res(), () => {})
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  })
})
