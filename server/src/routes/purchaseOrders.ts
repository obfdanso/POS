import express from 'express'
import { body, param, query } from 'express-validator'
import * as controller from '../controllers/purchaseOrderController'
import { authenticate, authorize } from '../middleware/auth'
import { requireBranch } from '../middleware/branch'
import validate from '../middleware/validate'
import exactBody from '../middleware/exactBody'
import paginationRules from '../middleware/pagination'
import { sortRules } from '../middleware/sorting'
import { PO_SORTS } from '../services/purchaseOrderService'

const router = express.Router()

// Ordering and receiving stock is inventory management: managers and admins only
router.use(authenticate, authorize(['ADMIN', 'MANAGER']))

const idRule = () => param('id').isUUID().withMessage('Invalid purchase order ID')
const text = (field: string, label: string, max: number) =>
  body(field).optional({ values: 'null' }).isString().withMessage(`${label} must be text`).trim()
    .isLength({ max }).withMessage(`${label} must be ${max} characters or fewer`)

router.get(
  '/',
  [
    ...paginationRules,
    ...sortRules(Object.keys(PO_SORTS)),
    query('status').optional().isIn(['ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']).withMessage('Invalid status'),
    query('supplier_id').optional().isUUID().withMessage('Invalid supplier ID'),
    query('search').optional().isString().withMessage('Search must be text').trim().isLength({ max: 50 }),
    query('start_date').optional().isISO8601().withMessage('start_date must be a valid date'),
    query('end_date').optional().isISO8601().withMessage('end_date must be a valid date'),
  ],
  validate,
  controller.listPurchaseOrders
)

router.get(
  '/suggestions',
  requireBranch,
  query('supplier_id').isUUID().withMessage('Choose a supplier'),
  validate,
  controller.getReorderSuggestions
)

router.get('/:id', idRule(), validate, controller.getPurchaseOrder)

router.post(
  '/',
  requireBranch,
  exactBody([
    body('supplier_id').isUUID().withMessage('Choose a supplier'),
    body('items').isArray({ min: 1, max: 200 }).withMessage('An order needs between 1 and 200 items'),
    body('items.*.product_id').isUUID().withMessage('Each item needs a valid product'),
    body('items.*.quantity').isInt({ min: 1, max: 100000 }).withMessage('Each quantity must be between 1 and 100,000').toInt(),
    body('items.*.unit_cost').isFloat({ min: 0, max: 1000000 }).withMessage('Each unit cost must be between 0 and 1,000,000').toFloat(),
    body('expected_at').optional({ values: 'null' }).isISO8601().withMessage('Expected date must be a valid date'),
    text('notes', 'Notes', 500),
  ]),
  validate,
  controller.createPurchaseOrder
)

router.post(
  '/:id/receive',
  idRule(),
  exactBody([
    body('items').optional().isArray({ min: 1, max: 200 }).withMessage('items must list between 1 and 200 order lines'),
    body('items.*.item_id').isUUID().withMessage('Each item needs a valid item_id'),
    body('items.*.quantity').isInt({ min: 0, max: 100000 }).withMessage('Each quantity must be 0 or more').toInt(),
    body('update_cost').optional().isBoolean().withMessage('update_cost must be true or false').toBoolean(),
    text('notes', 'Notes', 300),
  ]),
  validate,
  controller.receivePurchaseOrder
)

router.post('/:id/cancel', idRule(), exactBody([text('reason', 'Reason', 300)]), validate, controller.cancelPurchaseOrder)

export default router
