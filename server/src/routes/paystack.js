const express = require('express')
const { isValidPaystackSignature } = require('../utils/paystack')
const { applyRefundWebhook } = require('../services/gatewayRefundService')
const { logger } = require('../middleware/logger')

const router = express.Router()

// Paystack calls this (no login) with refund updates. Set the URL in the Paystack dashboard under
// Settings → API Keys & Webhooks: https://<your server>/api/paystack/webhook
router.post('/webhook', async (req, res, next) => {
  try {
    if (!isValidPaystackSignature(req.rawBody, req.get('x-paystack-signature'))) {
      return res.status(401).json({ success: false, error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' } })
    }
    const updated = await applyRefundWebhook(req.body)
    if (updated) logger.info(`Paystack webhook ${req.body.event} applied`)
    // Always 200 for a genuine event, or Paystack keeps retrying it
    res.json({ success: true, data: null })
  } catch (err) {
    next(err)
  }
})

module.exports = router
