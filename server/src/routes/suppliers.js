const express = require('express')
const { body, param } = require('express-validator')
const supplierController = require('../controllers/supplierController')
const { authenticate, authorize } = require('../middleware/auth')
const validate = require('../middleware/validate')
const paginationRules = require('../middleware/pagination')

const router = express.Router()

router.use(authenticate)

const supplierValidation = [
  body('name').notEmpty().trim().isLength({ max: 150 }).withMessage('Supplier name is required (max 150 chars)'),
  body('phone').optional({ checkFalsy: true }).trim().isLength({ max: 30 }).withMessage('Phone too long'),
  body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail().withMessage('Valid email required'),
  body('address').optional({ checkFalsy: true }).trim().isLength({ max: 255 }).withMessage('Address too long'),
  body('website').optional({ checkFalsy: true }).trim().isLength({ max: 255 }).withMessage('Website URL too long'),
]

// Any authenticated user can list/view suppliers (needed for product forms)
const idRule = param('id').isUUID().withMessage('Invalid supplier ID')

router.get('/', paginationRules, validate, supplierController.listSuppliers)
router.get('/:id', idRule, validate, supplierController.getSupplier)

// Only ADMIN and MANAGER can create/update/delete
router.post('/', authorize(['ADMIN', 'MANAGER']), supplierValidation, validate, supplierController.createSupplier)
router.put('/:id', authorize(['ADMIN', 'MANAGER']), idRule, supplierValidation, validate, supplierController.updateSupplier)
router.delete('/:id', authorize(['ADMIN']), idRule, validate, supplierController.deleteSupplier)

module.exports = router
