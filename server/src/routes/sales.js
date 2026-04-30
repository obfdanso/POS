const express = require('express')
const { body, param } = require('express-validator')
const rateLimit = require('express-rate-limit')
const salesController = require('../controllers/salesController')
const { authenticate, authorize } = require('../middleware/auth')
const validate = require('../middleware/validate')

const router = express.Router()

router.use(authenticate)

// Prevent runaway sale creation: max 60 sales per minute per IP
const salesRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
})

const saleValidation = [
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.product_id').isUUID().withMessage('Each item must have a valid product ID'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Each item quantity must be >= 1'),
  body('items.*.discount').optional().isFloat({ min: 0 }).withMessage('Item discount must be >= 0'),
  body('payment_method')
    .isIn(['CASH', 'MOBILE_MONEY', 'CARD'])
    .withMessage('Payment method must be CASH, MOBILE_MONEY, or CARD'),
  body('amount_paid').isFloat({ min: 0 }).withMessage('Amount paid must be >= 0'),
  body('discount_amount').optional().isFloat({ min: 0 }).withMessage('Discount must be >= 0'),
  body('customer_id').optional({ nullable: true }).isUUID().withMessage('Customer ID must be a valid UUID'),
  body('reference')
    .if(body('payment_method').isIn(['MOBILE_MONEY', 'CARD']))
    .notEmpty()
    .trim()
    .withMessage('Payment reference is required for non-cash transactions'),
  body('notes').optional().trim().isLength({ max: 500 }).withMessage('Notes must be 500 characters or fewer'),
]

router.post('/', salesRateLimit, saleValidation, validate, salesController.createSale)
router.get('/', salesController.listSales)
router.get('/:id', authorize(['ADMIN', 'MANAGER', 'CASHIER']), param('id').isUUID(), validate, salesController.getSale)
router.get('/:id/receipt', authorize(['ADMIN', 'MANAGER', 'CASHIER']), param('id').isUUID(), validate, salesController.getReceipt)
router.post(
  '/:id/refund',
  authorize(['ADMIN', 'MANAGER']),
  param('id').isUUID(),
  validate,
  salesController.processRefund
)

module.exports = router
