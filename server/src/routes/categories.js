const express = require('express')
const { body, param } = require('express-validator')
const productController = require('../controllers/productController')
const { authenticate, authorize } = require('../middleware/auth')
const validate = require('../middleware/validate')
const exactBody = require('../middleware/exactBody')

const router = express.Router()

router.use(authenticate)

const categoryValidation = [
  body('name').trim().notEmpty().withMessage('Category name is required'),
  body('description').optional({ values: 'null' }).trim().isLength({ max: 255 }).withMessage('Description must be 255 characters or fewer'),
]

router.get('/', productController.listCategories)
router.post('/', authorize(['ADMIN', 'MANAGER']), exactBody(categoryValidation), validate, productController.createCategory)
router.put(
  '/:id',
  authorize(['ADMIN', 'MANAGER']),
  param('id').isUUID().withMessage('Invalid category ID'),
  exactBody(categoryValidation),
  validate,
  productController.updateCategory
)

module.exports = router
