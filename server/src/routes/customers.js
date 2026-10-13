const express = require('express')
const { body, param, query } = require('express-validator')
const customerController = require('../controllers/customerController')
const { authenticate, authorize } = require('../middleware/auth')
const validate = require('../middleware/validate')

const router = express.Router()

router.use(authenticate)

// Built per route: validation chains are mutable, so create and update must not share instances
function customerValidation({ nameRequired }) {
  const name = body('name').trim()
  return [
    nameRequired
      ? name.notEmpty().withMessage('Name is required')
      : name.optional().notEmpty().withMessage('Name cannot be empty'),
    body('phone').optional({ values: 'falsy' }).trim(),
    body('email').optional({ values: 'falsy' }).trim().isEmail().withMessage('Valid email required'),
    body('address').optional({ values: 'falsy' }).trim(),
  ]
}

router.get(
  '/',
  [query('page').optional().isInt({ min: 1 }), query('per_page').optional().isInt({ min: 1, max: 100 })],
  validate,
  customerController.listCustomers
)
router.get('/:id', authorize(['ADMIN', 'MANAGER', 'CASHIER']), param('id').isUUID().withMessage('Invalid customer ID'), validate, customerController.getCustomer)
router.post('/', authorize(['ADMIN', 'MANAGER', 'CASHIER']), customerValidation({ nameRequired: true }), validate, customerController.createCustomer)
router.put(
  '/:id',
  authorize(['ADMIN', 'MANAGER']),
  [param('id').isUUID().withMessage('Invalid customer ID'), ...customerValidation({ nameRequired: false })],
  validate,
  customerController.updateCustomer
)
router.get(
  '/:id/purchases',
  authorize(['ADMIN', 'MANAGER', 'CASHIER']),
  param('id').isUUID().withMessage('Invalid customer ID'),
  validate,
  customerController.getCustomerPurchases
)

module.exports = router
