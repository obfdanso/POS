/** One field-level problem, so forms can show it next to the input. */
export interface ErrorDetail {
  field: string
  message: string
}

export class AppError extends Error {
  statusCode: number
  code: string
  isOperational: boolean
  // `declare` so errors without details don't get an own `details: undefined` property
  declare details?: ErrorDetail[]

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message)
    this.statusCode = statusCode
    this.code = code
    this.isOperational = true
    Error.captureStackTrace(this, this.constructor)
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details: ErrorDetail[] = []) {
    super(message, 422, 'VALIDATION_ERROR')
    this.details = details
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED')
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN')
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND')
  }
}

export class ConflictError extends AppError {
  // Pass `field` when the conflict is about one input, so forms can show it inline
  constructor(message: string, field?: string) {
    super(message, 409, 'CONFLICT')
    if (field) this.details = [{ field, message }]
  }
}
