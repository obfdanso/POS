import express from 'express'
import { body, param, query } from 'express-validator'
import * as inventoryController from '../controllers/inventoryController'
import { authenticate, authorize } from '../middleware/auth'
import { requireBranch } from '../middleware/branch'
import validate from '../middleware/validate'
import exactBody from '../middleware/exactBody'
import paginationRules from '../middleware/pagination'
import { sortRules } from '../middleware/sorting'
import { INVENTORY_SORTS } from '../services/inventoryService'

const router = express.Router()

router.use(authenticate)

router.get(
  '/',
  authorize(['ADMIN', 'MANAGER', 'CASHIER']),
  [
    ...paginationRules,
    ...sortRules(Object.keys(INVENTORY_SORTS)),
    query('status').optional().isIn(['out']).withMessage('Status must be "out"'),
    query('search').optional().isString().withMessage('Search must be text').trim().isLength({ max: 100 }),
  ],
  validate,
  inventoryController.listInventory
)
router.get('/low-stock', authorize(['ADMIN', 'MANAGER', 'CASHIER']), inventoryController.getLowStock)
router.get('/log/:productId',
  authorize(['ADMIN', 'MANAGER', 'CASHIER']),
  [param('productId').isUUID().withMessage('Invalid product ID'), ...paginationRules],
  validate,
  inventoryController.getInventoryLog
)
router.post(
  '/adjust',
  authorize(['ADMIN', 'MANAGER']),
  requireBranch,
  exactBody([
    body('product_id').isUUID().withMessage('Valid product ID required'),
    body('quantity_change')
      .isInt({ min: -100000, max: 100000 })
      .withMessage('Quantity change must be a whole number between -100000 and 100000')
      .custom((v) => Number(v) !== 0)
      .withMessage('Quantity change must be a non-zero integer')
      .toInt(),
    body('notes').optional().trim().isLength({ max: 500 }).withMessage('Notes must be 500 characters or fewer'),
  ]),
  validate,
  inventoryController.adjustStock
)
router.post(
  '/restock',
  authorize(['ADMIN', 'MANAGER']),
  requireBranch,
  exactBody([
    body('product_id').isUUID().withMessage('Valid product ID required'),
    body('quantity').isInt({ min: 1, max: 100000 }).withMessage('Quantity must be between 1 and 100000').toInt(),
    body('notes').optional().trim().isLength({ max: 500 }).withMessage('Notes must be 500 characters or fewer'),
  ]),
  validate,
  inventoryController.restockProduct
)

export default router
