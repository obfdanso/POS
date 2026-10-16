const { validationResult } = require('express-validator')
const { ValidationError } = require('../utils/errors')

function validate(req, res, next) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    const details = errors.array().flatMap((err) =>
      // checkExact reports every unexpected field in one error
      err.type === 'unknown_fields'
        ? err.fields.map((f) => ({ field: f.path, message: `Unexpected field "${f.path}"` }))
        : [{ field: err.path || err.param, message: err.msg }]
    )
    return next(new ValidationError('Validation failed', details))
  }
  next()
}

module.exports = validate
