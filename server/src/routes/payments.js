const express = require('express')
const { authenticate } = require('../middleware/auth')

const router = express.Router()

// POST /api/payments/verify/:reference
// Verifies a Paystack transaction by reference
router.post('/verify/:reference', authenticate, async (req, res, next) => {
  try {
    const { reference } = req.params
    const paystackSecret = process.env.PAYSTACK_SECRET_KEY

    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
          'Content-Type': 'application/json',
        },
      }
    )

    const result = await response.json()

    if (!response.ok || !result.status) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PAYMENT_VERIFICATION_FAILED',
          message: result.message || 'Payment verification failed',
        },
      })
    }

    return res.status(200).json({
      success: true,
      data: result.data,
      message: 'Payment verified successfully',
    })
  } catch (err) {
    next(err)
  }
})

module.exports = router
