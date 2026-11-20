import express from 'express'
import { body, param } from 'express-validator'
import * as productController from '../controllers/productController'
import { authenticate, authorize } from '../middleware/auth'
import validate from '../middleware/validate'
import exactBody from '../middleware/exactBody'

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

export default router
