const express = require('express')
const { body, param, query } = require('express-validator')
const customerController = require('../controllers/customerController')
const { authenticate, authorize } = require('../middleware/auth')
const validate = require('../middleware/validate')
const exactBody = require('../middleware/exactBody')
const paginationRules = require('../middleware/pagination')
const { sortRules } = require('../middleware/sorting')
const { CUSTOMER_SORTS } = require('../services/customerService')

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
  [...paginationRules, ...sortRules(Object.keys(CUSTOMER_SORTS)), query('search').optional().trim()],
  validate,
  customerController.listCustomers
)
router.get('/:id', authorize(['ADMIN', 'MANAGER', 'CASHIER']), param('id').isUUID().withMessage('Invalid customer ID'), validate, customerController.getCustomer)
router.post('/', authorize(['ADMIN', 'MANAGER', 'CASHIER']), exactBody(customerValidation({ nameRequired: true })), validate, customerController.createCustomer)
router.put(
  '/:id',
  authorize(['ADMIN', 'MANAGER']),
  [param('id').isUUID().withMessage('Invalid customer ID'), ...exactBody(customerValidation({ nameRequired: false }))],
  validate,
  customerController.updateCustomer
)
router.get(
  '/:id/purchases',
  authorize(['ADMIN', 'MANAGER', 'CASHIER']),
  [param('id').isUUID().withMessage('Invalid customer ID'), ...paginationRules],
  validate,
  customerController.getCustomerPurchases
)

module.exports = router
