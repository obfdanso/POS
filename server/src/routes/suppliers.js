const express = require('express')
const { body } = require('express-validator')
const supplierController = require('../controllers/supplierController')
const { authenticate, authorize } = require('../middleware/auth')
const validate = require('../middleware/validate')

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
router.get('/', supplierController.listSuppliers)
router.get('/:id', supplierController.getSupplier)

// Only ADMIN and MANAGER can create/update/delete
router.post('/', authorize(['ADMIN', 'MANAGER']), supplierValidation, validate, supplierController.createSupplier)
router.put('/:id', authorize(['ADMIN', 'MANAGER']), supplierValidation, validate, supplierController.updateSupplier)
router.delete('/:id', authorize(['ADMIN']), supplierController.deleteSupplier)

module.exports = router
