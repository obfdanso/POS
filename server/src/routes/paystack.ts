import express, { type NextFunction, type Request, type Response } from 'express'
import { body } from 'express-validator'
import validate from '../middleware/validate'
import { isValidPaystackSignature } from '../utils/paystack'
import { applyRefundWebhook, type RefundWebhookEvent } from '../services/gatewayRefundService'
import { logger } from '../middleware/logger'

const router = express.Router()

// Paystack calls this (no login) with refund updates. Set the URL in the Paystack dashboard under
// Settings → API Keys & Webhooks: https://<your server>/api/paystack/webhook
function checkSignature(req: Request, res: Response, next: NextFunction) {
  if (!isValidPaystackSignature(req.rawBody, req.get('x-paystack-signature'))) {
    return res.status(401).json({ success: false, error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' } })
  }
  next()
}

const webhookValidation = [
  body('event').isString().withMessage('event must be text').isLength({ max: 100 }),
  body('data').isObject().withMessage('data must be an object'),
]

router.post('/webhook', checkSignature, webhookValidation, validate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validated above: an event name and a data object
    const event = req.body as RefundWebhookEvent
    const updated = await applyRefundWebhook(event)
    if (updated) logger.info(`Paystack webhook ${event.event} applied`)
    // Always 200 for a genuine event, or Paystack keeps retrying it
    res.json({ success: true, data: null })
  } catch (err) {
    next(err)
  }
})

export default router
