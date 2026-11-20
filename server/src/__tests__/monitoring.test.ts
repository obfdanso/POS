import './loadEnv'
import { app, prisma, request } from './helpers'
import type { Request, Response } from 'express'
import errorHandler from '../middleware/errorHandler'

afterAll(() => prisma.$disconnect())

describe('Request IDs', () => {
  it('tags every response with a generated ID', async () => {
    const res = await request(app).get('/api/health')
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
    const again = await request(app).get('/api/health')
    expect(again.headers['x-request-id']).not.toBe(res.headers['x-request-id'])
  })

  it('reuses a well-formed incoming ID and replaces a malformed one', async () => {
    const reused = await request(app).get('/api/health').set('X-Request-Id', 'till-3.req_42')
    expect(reused.headers['x-request-id']).toBe('till-3.req_42')
    const replaced = await request(app).get('/api/health').set('X-Request-Id', 'bad id "quoted" '.padEnd(80, 'x'))
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('includes the ID in unexpected-error responses so staff can quote it', () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() }
    errorHandler(new Error('boom'), { id: 'req-123' } as Partial<Request> as Request, res as Partial<Response> as Response, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json.mock.calls[0][0].error).toMatchObject({ code: 'INTERNAL_ERROR', request_id: 'req-123' })
  })
})

describe('GET /api/health/ready', () => {
  it('reports ready when the database answers', async () => {
    const res = await request(app).get('/api/health/ready')
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ status: 'ready', database: 'ok' })
  })

  it('answers 503 when the database is unreachable', async () => {
    const spy = jest.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('connection refused'))
    const res = await request(app).get('/api/health/ready')
    spy.mockRestore()
    expect(res.status).toBe(503)
    expect(res.body.error).toEqual({ code: 'SERVICE_UNAVAILABLE', message: 'Database unreachable' })
  })
})
