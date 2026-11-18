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
    .isIn(['CASH', 'MOBILE_MONEY', 'CARD', 'SPLIT'])
    .withMessage('Payment method must be CASH, MOBILE_MONEY, CARD, or SPLIT'),
  // A split payment gives its amounts in `payments` instead
  body('amount_paid')
    .if((value, { req }) => req.body.payment_method !== 'SPLIT')
    .isFloat({ min: 0, max: 1000000 }).withMessage('Amount paid must be between 0 and 1000000').toFloat(),
  body('payments')
    .if(body('payment_method').equals('SPLIT'))
    .isArray({ min: 2, max: 3 }).withMessage('A split payment needs 2 or 3 parts'),
  body('payments')
    .if((value, { req }) => req.body.payment_method !== 'SPLIT')
    .not().exists().withMessage('payments is only used with a SPLIT payment'),
  body('payments.*.method').isIn(['CASH', 'MOBILE_MONEY', 'CARD']).withMessage('Each part must be CASH, MOBILE_MONEY, or CARD'),
  body('payments.*.amount').isFloat({ min: 0.01, max: 1000000 }).withMessage('Each part must be between 0.01 and 1000000').toFloat(),
  body('payments.*.reference').optional().isString().withMessage('Reference must be text').trim()
    .isLength({ min: 1, max: 100 }).withMessage('Reference must be 1 to 100 characters'),
  body('discount_amount').optional().isFloat({ min: 0, max: 1000000 }).withMessage('Discount must be >= 0').toFloat(),
  body('redeem_points').optional().isInt({ min: 0, max: 1000000 }).withMessage('Points to redeem must be a whole number, 0 or more').toInt(),
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
  query('payment_status').optional().isIn(['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'PENDING']).withMessage('Invalid payment status'),
  query('payment_method').optional().isIn(['CASH', 'MOBILE_MONEY', 'CARD', 'SPLIT']).withMessage('Invalid payment method'),
  query('search').optional().isString().withMessage('Search must be text').trim().isLength({ max: 50 }),
  ...sortRules(Object.keys(SALE_SORTS)),
]

router.get('/', listSalesValidation, validate, salesController.listSales)
router.get('/:id', authorize(['ADMIN', 'MANAGER', 'CASHIER']), param('id').isUUID(), validate, salesController.getSale)
router.get('/:id/receipt', authorize(['ADMIN', 'MANAGER', 'CASHIER']), param('id').isUUID(), validate, salesController.getReceipt)
// Body is optional: with no `items`, everything not yet returned is refunded
const refundValidation = [
  body('items').optional().isArray({ min: 1, max: 200 }).withMessage('items must list between 1 and 200 sale lines'),
  body('items.*.sale_item_id').isUUID().withMessage('Each item needs a valid sale_item_id'),
  body('items.*.quantity').isInt({ min: 1, max: 100000 }).withMessage('Each returned quantity must be at least 1').toInt(),
  body('items.*.restock').optional().isBoolean().withMessage('restock must be true or false').toBoolean(),
  body('reason').optional().isString().withMessage('Reason must be text').trim()
    .isLength({ max: 500 }).withMessage('Reason must be 500 characters or fewer'),
]

router.post(
  '/:id/refund',
  authorize(['ADMIN', 'MANAGER']),
  param('id').isUUID(),
  exactBody(refundValidation),
  validate,
  salesController.processRefund
)

// Sends a refund's card / Mobile Money part through Paystack, or checks on one already sent
router.post(
  '/:id/refunds/:refundId/paystack',
  authorize(['ADMIN', 'MANAGER']),
  param('id').isUUID(),
  param('refundId').isUUID(),
  exactBody([]),
  validate,
  salesController.sendRefundToPaystack
)

// Each receipt email goes to an outside address, so limit how many one user can send
const emailRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user.id,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many receipt emails. Wait a minute and try again.' } },
})

// With no `email`, the receipt goes to the customer's address on file
router.post(
  '/:id/email-receipt',
  authorize(['ADMIN', 'MANAGER', 'CASHIER']),
  emailRateLimit,
  param('id').isUUID(),
  exactBody([
    body('email').optional().isString().withMessage('Email must be text').trim()
      .isEmail().withMessage('Enter a valid email address')
      .isLength({ max: 254 }).withMessage('Email must be 254 characters or fewer'),
  ]),
  validate,
  salesController.emailReceipt
)

// Each text costs money and goes to an outside number, so limit how many one user can send
const smsRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.user.id,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many receipt texts. Wait a minute and try again.' } },
})

// With no `phone`, the receipt goes to the customer's number on file
router.post(
  '/:id/sms-receipt',
  authorize(['ADMIN', 'MANAGER', 'CASHIER']),
  smsRateLimit,
  param('id').isUUID(),
  exactBody([
    body('phone').optional().isString().withMessage('Phone number must be text').trim()
      .isLength({ min: 1, max: 20 }).withMessage('Phone number must be 1 to 20 characters'),
  ]),
  validate,
  salesController.smsReceipt
)

module.exports = router
