const express = require('express')
const { body, param } = require('express-validator')
const inventoryController = require('../controllers/inventoryController')
const { authenticate, authorize } = require('../middleware/auth')
const validate = require('../middleware/validate')

const router = express.Router()

router.use(authenticate)

router.get('/', authorize(['ADMIN', 'MANAGER', 'CASHIER']), inventoryController.listInventory)
router.get('/low-stock', authorize(['ADMIN', 'MANAGER', 'CASHIER']), inventoryController.getLowStock)
router.get('/log/:productId',
  authorize(['ADMIN', 'MANAGER', 'CASHIER']),
  param('productId').isUUID().withMessage('Invalid product ID'),
  validate,
  inventoryController.getInventoryLog
)
router.post(
  '/adjust',
  authorize(['ADMIN', 'MANAGER']),
  [
    body('product_id').isUUID().withMessage('Valid product ID required'),
    body('quantity_change')
      .isInt()
      .custom((v) => Number(v) !== 0)
      .withMessage('Quantity change must be a non-zero integer')
      .toInt(),
    body('notes').optional().trim().isLength({ max: 500 }).withMessage('Notes must be 500 characters or fewer'),
  ],
  validate,
  inventoryController.adjustStock
)
router.post(
  '/restock',
  authorize(['ADMIN', 'MANAGER']),
  [
    body('product_id').isUUID().withMessage('Valid product ID required'),
    body('quantity').isInt({ min: 1 }).withMessage('Quantity must be >= 1').toInt(),
    body('notes').optional().trim().isLength({ max: 500 }).withMessage('Notes must be 500 characters or fewer'),
  ],
  validate,
  inventoryController.restockProduct
)

module.exports = router
