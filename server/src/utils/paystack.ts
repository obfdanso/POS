const https = require('https')
const crypto = require('crypto')
const { AppError } = require('./errors')
const { logger } = require('../middleware/logger')

/** Calls the Paystack API and resolves with its JSON body, whatever the HTTP status. */
function paystackRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return reject(new AppError('Paystack Secret Key is not configured', 500))
    }
    const payload = body ? JSON.stringify(body) : null

    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path,
      method,
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        ...(payload && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
      },
    }

    const req = https.request(options, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        try {
          // Application-level errors (status: false) are left to the caller
          resolve(JSON.parse(data))
        } catch {
          reject(new AppError('Failed to parse Paystack response', 503))
        }
      })
    })

    req.on('error', (e) => {
      logger.error(`Paystack ${method} ${path.split('?')[0]} failed: ${e.message}`)
      reject(new AppError('Payment gateway unavailable', 503))
    })

    req.setTimeout(8000, () => {
      req.destroy()
      reject(new AppError('Payment gateway timed out', 503))
    })

    if (payload) req.write(payload)
    req.end()
  })
}

function verifyPaystackPayment(reference) {
  return paystackRequest('GET', `/transaction/verify/${encodeURIComponent(reference)}`)
}

/** Asks Paystack to give back `amountPesewas` of the charge `reference`. Paystack queues it. */
function refundPaystackPayment(reference, amountPesewas, note) {
  return paystackRequest('POST', '/refund', {
    transaction: reference,
    amount: amountPesewas,
    currency: 'GHS',
    ...(note && { merchant_note: note.slice(0, 200) }),
  })
}

/** Looks up a refund created with refundPaystackPayment, by Paystack's refund id. */
function fetchPaystackRefund(refundId) {
  return paystackRequest('GET', `/refund/${encodeURIComponent(refundId)}`)
}

/** Whether a webhook body really came from Paystack: its HMAC-SHA512 with the secret key. */
function isValidPaystackSignature(rawBody, signature) {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret || !rawBody || typeof signature !== 'string') return false
  const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex')
  const given = Buffer.from(signature, 'utf8')
  const wanted = Buffer.from(expected, 'utf8')
  return given.length === wanted.length && crypto.timingSafeEqual(given, wanted)
}

module.exports = { verifyPaystackPayment, refundPaystackPayment, fetchPaystackRefund, isValidPaystackSignature }
