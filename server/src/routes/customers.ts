import express from 'express'
import { body, param, query } from 'express-validator'
import * as customerController from '../controllers/customerController'
import { authenticate, authorize } from '../middleware/auth'
import validate from '../middleware/validate'
import exactBody from '../middleware/exactBody'
import paginationRules from '../middleware/pagination'
import { sortRules } from '../middleware/sorting'
import { CUSTOMER_SORTS } from '../services/customerService'

const router = express.Router()

router.use(authenticate)

// Built per route: validation chains are mutable, so create and update must not share instances
function customerValidation({ nameRequired }: { nameRequired: boolean }) {
  const name = body('name').isString().withMessage('Name must be text').trim()
  return [
    nameRequired
      ? name.notEmpty().withMessage('Name is required')
      : name.optional().notEmpty().withMessage('Name cannot be empty'),
    body('phone').optional({ values: 'falsy' }).isString().withMessage('Phone must be text').trim(),
    body('email').optional({ values: 'falsy' }).trim().isEmail().withMessage('Valid email required'),
    body('address').optional({ values: 'falsy' }).isString().withMessage('Address must be text').trim(),
  ]
}

router.get(
  '/',
  [...paginationRules, ...sortRules(Object.keys(CUSTOMER_SORTS)), query('search').optional().isString().withMessage('Search must be text').trim().isLength({ max: 100 })],
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

export default router
