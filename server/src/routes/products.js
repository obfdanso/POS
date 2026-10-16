const express = require('express')
const { body, param, query } = require('express-validator')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const productController = require('../controllers/productController')
const { authenticate, authorize } = require('../middleware/auth')
const validate = require('../middleware/validate')
const exactBody = require('../middleware/exactBody')
const { sortRules } = require('../middleware/sorting')
const { PRODUCT_SORTS } = require('../services/productService')
const { ValidationError } = require('../utils/errors')

const router = express.Router()

// Multer config for product image uploads
const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'products')
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`)
  },
})
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp']
    const ext = path.extname(file.originalname).toLowerCase()
    if (allowed.includes(ext)) cb(null, true)
    else cb(new ValidationError('Only image files are allowed', [{ field: 'image', message: 'Upload a JPG, PNG, or WebP image' }]))
  },
})

const productValidation = [
  body('name').notEmpty().trim().withMessage('Name is required'),
  body('sku').notEmpty().trim().withMessage('SKU is required'),
  body('barcode').optional({ values: 'falsy' }).trim().isLength({ max: 32 }).withMessage('Barcode must be 32 characters or fewer'),
  body('category_id').notEmpty().isUUID().withMessage('Valid category ID is required'),
  body('supplier_id').optional({ nullable: true, checkFalsy: true }).isUUID().withMessage('Valid supplier ID required'),
  body('price').isFloat({ min: 0.01 }).withMessage('Price must be greater than 0').toFloat(),
  body('cost_price').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('Cost price must be >= 0').toFloat(),
  body('quantity').optional().isInt({ min: 0 }).withMessage('Quantity must be >= 0').toInt(),
  body('low_stock_threshold').optional().isInt({ min: 0 }).withMessage('Threshold must be >= 0').toInt(),
  body('is_active').optional().isBoolean().withMessage('is_active must be true or false').toBoolean(),
]


// All routes require authentication
router.use(authenticate)

// Product routes
router.get('/', listProductsValidation(), validate, productController.listProducts)
router.get('/barcode/:code', productController.getProductByBarcode)
router.get('/:id', param('id').isUUID().withMessage('Invalid product ID'), validate, productController.getProduct)
router.post('/', authorize(['ADMIN', 'MANAGER']), upload.single('image'), exactBody(productValidation), validate, productController.createProduct)
router.put('/:id', authorize(['ADMIN', 'MANAGER']), upload.single('image'), exactBody(updateProductValidation()), validate, productController.updateProduct)
router.delete('/:id', authorize(['ADMIN']), param('id').isUUID().withMessage('Invalid product ID'), validate, productController.deleteProduct)


function listProductsValidation() {
  return [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be >= 1'),
    query('per_page').optional().isInt({ min: 1, max: 100 }).withMessage('Per page must be 1-100'),
    query('category_id').optional().isUUID().withMessage('Invalid category ID'),
    query('status').optional().isIn(['active', 'inactive', 'all']).withMessage('Status must be active, inactive, or all'),
    ...sortRules(Object.keys(PRODUCT_SORTS)),
  ]
}

function updateProductValidation() {
  return [
    param('id').isUUID().withMessage('Invalid product ID'),
    body('supplier_id').optional({ nullable: true, checkFalsy: true }).isUUID().withMessage('Valid supplier ID required'),
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('sku').optional().trim().notEmpty().withMessage('SKU cannot be empty'),
    body('barcode').optional({ values: 'falsy' }).trim().isLength({ max: 32 }).withMessage('Barcode must be 32 characters or fewer'),
    // Images are replaced by uploading a file; the body may only clear one
    body('image_url').optional({ values: 'null' }).custom(() => false).withMessage('image_url can only be set to null'),
    body('category_id').optional().isUUID().withMessage('Valid category ID is required'),
    body('price').optional().isFloat({ min: 0.01 }).withMessage('Price must be > 0').toFloat(),
    body('cost_price').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('Cost price must be >= 0').toFloat(),
    body('quantity').optional().isInt({ min: 0 }).withMessage('Quantity must be >= 0').toInt(),
    body('low_stock_threshold').optional().isInt({ min: 0 }).withMessage('Threshold must be >= 0').toInt(),
    body('is_active').optional().isBoolean().withMessage('is_active must be true or false').toBoolean(),
  ]
}

module.exports = router
