const express = require('express')
const { body, param, query } = require('express-validator')
const branchController = require('../controllers/branchController')
const { authenticate, authorize } = require('../middleware/auth')
const validate = require('../middleware/validate')
const exactBody = require('../middleware/exactBody')

const router = express.Router()

router.use(authenticate)

const nameRule = (required) => {
  const rule = body('name')
  return (required ? rule : rule.optional()).trim().isLength({ min: 2, max: 80 }).withMessage('Branch name must be 2–80 characters')
}
const codeRule = (required) => {
  const rule = body('code')
  return (required ? rule : rule.optional())
    .trim()
    .matches(/^[A-Z]{2,6}$/)
    .withMessage('Code must be 2–6 capital letters, e.g. KSI')
}
const detailRules = [
  body('address').optional({ nullable: true }).trim().isLength({ max: 200 }).withMessage('Address too long (max 200)'),
  body('phone').optional({ nullable: true }).trim().isLength({ max: 30 }).withMessage('Phone too long (max 30)'),
]
const idRule = param('id').isUUID().withMessage('Invalid branch ID')

// Everyone signed in can list open branches (switcher, product form); admins also see closed ones
router.get('/', [query('active').optional().isIn(['true', 'false']).withMessage('active must be true or false')], validate, branchController.listBranches)
router.get('/:id', authorize(['ADMIN']), idRule, validate, branchController.getBranch)

router.post('/', authorize(['ADMIN']), exactBody([nameRule(true), codeRule(true), ...detailRules]), validate, branchController.createBranch)
router.put(
  '/:id',
  authorize(['ADMIN']),
  idRule,
  exactBody([
    nameRule(false),
    codeRule(false),
    ...detailRules,
    body('is_active').optional().isBoolean().withMessage('is_active must be true or false').toBoolean(),
  ]),
  validate,
  branchController.updateBranch
)

module.exports = router
