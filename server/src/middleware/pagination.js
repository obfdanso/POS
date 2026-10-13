const { query } = require('express-validator')

// Shared ?page / ?per_page rules for list endpoints (pair with the validate middleware)
const paginationRules = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be >= 1'),
  query('per_page').optional().isInt({ min: 1, max: 100 }).withMessage('Per page must be 1-100'),
]

module.exports = paginationRules
