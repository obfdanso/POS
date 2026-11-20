import crypto from 'crypto'
import type { NextFunction, Request, Response } from 'express'

// Accept an ID from a proxy or client only if it looks like one, so logs can't be polluted
const VALID_ID = /^[\w.-]{1,64}$/

/**
 * Gives every request an ID (reusing a sane incoming X-Request-Id), returns it in the
 * X-Request-Id response header, and makes it available as req.id for logs and error responses.
 */
function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.get('X-Request-Id')
  req.id = incoming && VALID_ID.test(incoming) ? incoming : crypto.randomUUID()
  res.set('X-Request-Id', req.id)
  next()
}

export default requestId
