const express = require('express')
const { body, param, query } = require('express-validator')
const controller = require('../controllers/promotionController')
const { authenticate, authorize } = require('../middleware/auth')
const validate = require('../middleware/validate')
const exactBody = require('../middleware/exactBody')

const router = express.Router()

router.use(authenticate)

// Every till needs the running promotions to price the cart the way the server will
router.get('/active', controller.listActive)

const manage = authorize(['ADMIN', 'MANAGER'])
const idRule = () => param('id').isUUID().withMessage('Invalid promotion ID')

// Built per route because validation chains are mutable; `required` makes the core fields mandatory
const promotionRules = (required) => {
  const opt = (chain) => (required ? chain : chain.optional())
  return [
    opt(body('name')).isString().withMessage('Name must be text').trim()
      .isLength({ min: 1, max: 100 }).withMessage('Name is required (max 100 characters)'),
    opt(body('percent_off')).isFloat({ min: 0.01, max: 100 }).withMessage('Percent off must be between 0.01 and 100').toFloat(),
    body('product_id').optional({ values: 'null' }).isUUID().withMessage('Invalid product'),
    body('category_id').optional({ values: 'null' }).isUUID().withMessage('Invalid category'),
    body('starts_at').optional().isISO8601().withMessage('Start must be a valid date'),
    body('ends_at').optional({ values: 'null' }).isISO8601().withMessage('End must be a valid date'),
    body('is_active').optional().isBoolean().withMessage('is_active must be true or false').toBoolean(),
  ]
}

router.get(
  '/',
  manage,
  query('status').optional().isIn(['ACTIVE', 'SCHEDULED', 'ENDED', 'OFF']).withMessage('Invalid status'),
  validate,
  controller.list
)
router.get('/:id', manage, idRule(), validate, controller.get)
router.post('/', manage, exactBody(promotionRules(true)), validate, controller.create)
router.put('/:id', manage, idRule(), exactBody(promotionRules(false)), validate, controller.update)

module.exports = router
