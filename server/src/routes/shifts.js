const express = require('express')
const { body, param, query } = require('express-validator')
const shiftController = require('../controllers/shiftController')
const { authenticate } = require('../middleware/auth')
const { requireBranch } = require('../middleware/branch')
const validate = require('../middleware/validate')
const exactBody = require('../middleware/exactBody')
const paginationRules = require('../middleware/pagination')
const { sortRules } = require('../middleware/sorting')
const { SHIFT_SORTS } = require('../services/shiftService')

const router = express.Router()

// Every role works a till, so every role can open and close its own shift.
// Cashiers are limited to their own shifts in the service, managers to their branch's; admins see all.
router.use(authenticate)

// A function: validation chains are mutable, so each route needs its own instance
const notes = () => body('notes').optional({ values: 'null' }).isString().withMessage('Notes must be text').trim()
  .isLength({ max: 500 }).withMessage('Notes must be 500 characters or fewer')

router.get('/current', shiftController.getCurrentShift)

router.post(
  '/open',
  requireBranch,
  exactBody([
    body('opening_float').isFloat({ min: 0, max: 1000000 }).withMessage('Opening float must be between 0 and 1,000,000').toFloat(),
    notes(),
  ]),
  validate,
  shiftController.openShift
)

router.post(
  '/:id/close',
  param('id').isUUID().withMessage('Invalid shift ID'),
  exactBody([
    body('counted_cash').isFloat({ min: 0, max: 10000000 }).withMessage('Counted cash must be 0 or more').toFloat(),
    notes(),
  ]),
  validate,
  shiftController.closeShift
)

router.get(
  '/',
  [
    ...paginationRules,
    ...sortRules(Object.keys(SHIFT_SORTS)),
    query('user_id').optional().isUUID().withMessage('Invalid user ID'),
    query('status').optional().isIn(['OPEN', 'CLOSED']).withMessage('Status must be OPEN or CLOSED'),
    query('start_date').optional().isISO8601().withMessage('start_date must be a valid date'),
    query('end_date').optional().isISO8601().withMessage('end_date must be a valid date'),
  ],
  validate,
  shiftController.listShifts
)

router.get('/:id', param('id').isUUID().withMessage('Invalid shift ID'), validate, shiftController.getShift)

module.exports = router
