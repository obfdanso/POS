const https = require('https')
const { AppError, ValidationError } = require('./errors')

function verifyPaystackPayment(reference) {
  return new Promise((resolve, reject) => {
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return reject(new AppError('Paystack Secret Key is not configured', 500))
    }

    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path: `/transaction/verify/${encodeURIComponent(reference)}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    }

    const req = https.request(options, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        try {
          const parsedData = JSON.parse(data)
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsedData)
          } else {
            resolve(parsedData) // Let the caller handle application-level errors
          }
        } catch (e) {
          reject(new AppError('Failed to parse Paystack response', 503))
        }
      })
    })

    req.on('error', (e) => {
      reject(new AppError('Payment verification unavailable', 503))
    })

    req.setTimeout(8000, () => {
      req.destroy()
      reject(new AppError('Payment gateway timed out', 503))
    })

    req.end()
  })
}

module.exports = { verifyPaystackPayment }
