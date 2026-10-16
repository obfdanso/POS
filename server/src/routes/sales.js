const express = require('express')
const { body, param, query } = require('express-validator')
const rateLimit = require('express-rate-limit')
const salesController = require('../controllers/salesController')
const { authenticate, authorize } = require('../middleware/auth')
const validate = require('../middleware/validate')
const exactBody = require('../middleware/exactBody')
const { sortRules } = require('../middleware/sorting')
const { SALE_SORTS } = require('../services/salesService')

const router = express.Router()

router.use(authenticate)

// Prevent runaway sale creation: max 60 sales per minute per IP
const salesRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
})

const saleValidation = [
  body('items').isArray({ min: 1, max: 200 }).withMessage('A sale needs between 1 and 200 items'),
  body('items.*.product_id').isUUID().withMessage('Each item must have a valid product ID'),
  body('items.*.quantity').isInt({ min: 1, max: 100000 }).withMessage('Each item quantity must be between 1 and 100000').toInt(),
  body('items.*.discount').optional().isFloat({ min: 0, max: 1000000 }).withMessage('Item discount must be >= 0').toFloat(),
  body('payment_method')
    .isIn(['CASH', 'MOBILE_MONEY', 'CARD'])
    .withMessage('Payment method must be CASH, MOBILE_MONEY, or CARD'),
  body('amount_paid').isFloat({ min: 0, max: 1000000 }).withMessage('Amount paid must be between 0 and 1000000').toFloat(),
  body('discount_amount').optional().isFloat({ min: 0, max: 1000000 }).withMessage('Discount must be >= 0').toFloat(),
  body('customer_id').optional({ nullable: true }).isUUID().withMessage('Customer ID must be a valid UUID'),
  body('reference')
    .if(body('payment_method').isIn(['MOBILE_MONEY', 'CARD']))
    .notEmpty()
    .trim()
    .withMessage('Payment reference is required for non-cash transactions'),
  body('notes').optional().trim().isLength({ max: 500 }).withMessage('Notes must be 500 characters or fewer'),
]

router.post('/', salesRateLimit, exactBody(saleValidation), validate, salesController.createSale)
const listSalesValidation = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be >= 1'),
  query('per_page').optional().isInt({ min: 1, max: 100 }).withMessage('Per page must be 1-100'),
  query('start_date').optional().isISO8601().withMessage('start_date must be a valid date'),
  query('end_date').optional().isISO8601().withMessage('end_date must be a valid date'),
  query('user_id').optional().isUUID().withMessage('Invalid user ID'),
  query('customer_id').optional().isUUID().withMessage('Invalid customer ID'),
  query('payment_status').optional().isIn(['COMPLETED', 'REFUNDED', 'PENDING']).withMessage('Invalid payment status'),
  query('payment_method').optional().isIn(['CASH', 'MOBILE_MONEY', 'CARD']).withMessage('Invalid payment method'),
  query('search').optional().trim().isLength({ max: 50 }),
  ...sortRules(Object.keys(SALE_SORTS)),
]

router.get('/', listSalesValidation, validate, salesController.listSales)
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
