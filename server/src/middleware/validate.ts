import { validationResult } from 'express-validator'
import type { NextFunction, Request, Response } from 'express'
import { ValidationError } from '../utils/errors'

function validate(req: Request, res: Response, next: NextFunction) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    const details = errors.array().flatMap((err) =>
      // checkExact reports every unexpected field in one error
      err.type === 'unknown_fields'
        ? err.fields.map((f) => ({ field: f.path, message: `Unexpected field "${f.path}"` }))
        : // Only field errors have a path (no route uses oneOf, which reports alternatives)
          [{ field: err.type === 'field' ? err.path : '', message: err.msg }]
    )
    return next(new ValidationError('Validation failed', details))
  }
  next()
}

export default validate
