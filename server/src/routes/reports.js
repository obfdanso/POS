const express = require('express')
const { query } = require('express-validator')
const reportController = require('../controllers/reportController')
const { authenticate, authorize } = require('../middleware/auth')
const validate = require('../middleware/validate')

const router = express.Router()

router.use(authenticate)

// Cashier-accessible route (must be registered before the ADMIN/MANAGER authorize middleware)
router.get('/cashier-stats', authorize(['ADMIN', 'MANAGER', 'CASHIER']), reportController.getCashierStats)

router.use(authorize(['ADMIN', 'MANAGER']))

// Every report accepts an optional date range (YYYY-MM-DD)
router.use(
  query('start_date').optional().isISO8601({ strict: true }).withMessage('start_date must be a valid date (YYYY-MM-DD)'),
  query('end_date').optional().isISO8601({ strict: true }).withMessage('end_date must be a valid date (YYYY-MM-DD)'),
  validate
)

const topProductsValidation = [
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100').toInt(),
  query('by').optional().isIn(['revenue', 'quantity']).withMessage('by must be revenue or quantity'),
  validate,
]

router.get('/dashboard', reportController.getDashboardSummary)
router.get('/sales-summary', reportController.getSalesSummary)
router.get('/sales-by-day', reportController.getSalesByDay)
router.get('/top-products', topProductsValidation, reportController.getTopProducts)
router.get('/category-performance', reportController.getCategoryPerformance)
router.get('/cashier-performance', reportController.getCashierPerformance)
router.get('/inventory-status', reportController.getInventoryStatus)
router.get('/profit', reportController.getProfitReport)

module.exports = router
