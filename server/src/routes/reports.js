const express = require('express')
const reportController = require('../controllers/reportController')
const { authenticate, authorize } = require('../middleware/auth')

const router = express.Router()

router.use(authenticate)

// Cashier-accessible route (must be registered before the ADMIN/MANAGER authorize middleware)
router.get('/cashier-stats', authorize(['ADMIN', 'MANAGER', 'CASHIER']), reportController.getCashierStats)

router.use(authorize(['ADMIN', 'MANAGER']))

router.get('/dashboard', reportController.getDashboardSummary)
router.get('/sales-summary', reportController.getSalesSummary)
router.get('/sales-by-day', reportController.getSalesByDay)
router.get('/top-products', reportController.getTopProducts)
router.get('/category-performance', reportController.getCategoryPerformance)
router.get('/cashier-performance', reportController.getCashierPerformance)
router.get('/inventory-status', reportController.getInventoryStatus)
router.get('/profit', reportController.getProfitReport)

module.exports = router
