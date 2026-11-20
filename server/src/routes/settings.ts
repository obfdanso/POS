import express, { type NextFunction, type Request, type Response } from 'express'
import { body } from 'express-validator'
import { authenticate, authorize, currentUser } from '../middleware/auth'
import validate from '../middleware/validate'
import exactBody from '../middleware/exactBody'
import prisma from '../utils/prismaClient'
import { recordAudit } from '../utils/audit'

const router = express.Router()

router.use(authenticate)

const DEFAULT_SETTINGS = {
  store_name: 'My POS Store',
  store_address: '',
  store_phone: '',
  tax_rate: '0',
  loyalty_points_rate: '10',
  // Money off per loyalty point at checkout; 0 turns redemption off
  loyalty_point_value: '0',
  currency_symbol: 'GH₵',
  receipt_footer: 'Thank you for your business!',
  // 'true' makes cashiers open a cash drawer shift before they can sell
  require_open_shift: 'false',
}

const settingsValidation = [
  body('store_name').optional().trim().isLength({ max: 100 }).withMessage('Store name must be 100 characters or less'),
  body('store_address').optional().trim().isLength({ max: 255 }).withMessage('Address must be 255 characters or less'),
  body('store_phone').optional().trim().isLength({ max: 20 }).withMessage('Phone must be 20 characters or less'),
  body('currency_symbol').optional().trim().isLength({ min: 1, max: 5 }).withMessage('Currency symbol must be 1–5 characters'),
  body('tax_rate')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Tax rate must be a number between 0 and 100'),
  body('loyalty_points_rate')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Loyalty rate must be 0 or greater'),
  body('loyalty_point_value')
    .optional()
    .isFloat({ min: 0, max: 1000 })
    .withMessage('Point value must be between 0 and 1000'),
  body('receipt_footer').optional().trim().isLength({ max: 200 }).withMessage('Receipt footer must be 200 characters or less'),
  body('require_open_shift').optional().isIn(['true', 'false', true, false]).withMessage('require_open_shift must be true or false'),
]

router.get('/', async (req, res, next) => {
  try {
    const rows = await prisma.settings.findMany()
    const settings: Record<string, string> = { ...DEFAULT_SETTINGS }
    rows.forEach((r) => { settings[r.key] = r.value })
    res.json({ success: true, data: settings })
  } catch (err) {
    next(err)
  }
})

router.put('/', authorize(['ADMIN']), exactBody(settingsValidation), validate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowed = Object.keys(DEFAULT_SETTINGS)
    const updates = Object.entries(req.body as Record<string, unknown>).filter(([k]) => allowed.includes(k))
    await Promise.all(
      updates.map(([key, value]) =>
        prisma.settings.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value) },
        })
      )
    )
    if (updates.length) {
      await recordAudit({
        userId: currentUser(req).id,
        action: 'SETTINGS_UPDATED',
        entity: 'Settings',
        details: updates.map(([key, value]) => `${key}=${value}`).join(', '),
      })
    }
    const rows = await prisma.settings.findMany()
    const settings: Record<string, string> = { ...DEFAULT_SETTINGS }
    rows.forEach((r) => { settings[r.key] = r.value })
    res.json({ success: true, data: settings, message: 'Settings saved successfully' })
  } catch (err) {
    next(err)
  }
})

export default router
