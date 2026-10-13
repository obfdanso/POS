const fs = require('fs')
const multer = require('multer')
const { logger } = require('./logger')

// Express recognises error handlers by their four parameters, so `_next` must stay
function errorHandler(err, req, res, _next) {
  // Log the error
  if (process.env.NODE_ENV === 'development') {
    logger.error(err.stack || err.message)
  } else {
    logger.error(err.message)
  }

  // Don't keep an uploaded image when the request that brought it failed
  if (req.file?.path) {
    fs.unlink(req.file.path, () => {})
  }

  // Malformed JSON body
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Request body is not valid JSON' },
    })
  }

  // Upload errors (e.g. file too large)
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 5 MB or smaller' : err.message
    return res.status(422).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message, details: [{ field: 'image', message }] },
    })
  }

  // Handle Prisma errors
  if (err.code === 'P2002') {
    return res.status(409).json({
      success: false,
      error: {
        code: 'CONFLICT',
        message: 'A record with that value already exists',
      },
    })
  }

  if (err.code === 'P2025') {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Record not found',
      },
    })
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid token',
      },
    })
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Token expired',
      },
    })
  }

  // Handle operational errors (our custom AppErrors)
  if (err.isOperational) {
    const response = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
    }
    if (err.details) {
      response.error.details = err.details
    }
    return res.status(err.statusCode).json(response)
  }

  // Unhandled/programming errors — don't leak details in production
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message:
        process.env.NODE_ENV === 'development'
          ? err.message
          : 'An unexpected error occurred',
    },
  })
}

module.exports = errorHandler
