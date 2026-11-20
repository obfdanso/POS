import https from 'https'
import crypto from 'crypto'
import { AppError } from './errors'
import { logger } from '../middleware/logger'

/** Paystack's JSON envelope. It comes from outside, so any field may be missing. */
export interface PaystackResponse<T> {
  status?: boolean
  message?: string
  data?: T
}

/** The fields of a verified transaction that this app reads. */
export interface PaystackTransaction {
  status?: string
  currency?: string
  amount?: number
  channel?: string
}

/** The fields of a refund that this app reads. */
export interface PaystackRefund {
  id?: number | string | null
  status?: string
}

/** Calls the Paystack API and resolves with its JSON body, whatever the HTTP status. */
function paystackRequest<T>(method: string, path: string, body?: Record<string, unknown>): Promise<PaystackResponse<T>> {
  return new Promise((resolve, reject) => {
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return reject(new AppError('Paystack Secret Key is not configured', 500))
    }
    const payload = body ? JSON.stringify(body) : null

    const options: https.RequestOptions = {
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
          resolve(JSON.parse(data) as PaystackResponse<T>)
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

export function verifyPaystackPayment(reference: string) {
  return paystackRequest<PaystackTransaction>('GET', `/transaction/verify/${encodeURIComponent(reference)}`)
}

/** Asks Paystack to give back `amountPesewas` of the charge `reference`. Paystack queues it. */
export function refundPaystackPayment(reference: string, amountPesewas: number, note?: string | null) {
  return paystackRequest<PaystackRefund>('POST', '/refund', {
    transaction: reference,
    amount: amountPesewas,
    currency: 'GHS',
    ...(note && { merchant_note: note.slice(0, 200) }),
  })
}

/** Looks up a refund created with refundPaystackPayment, by Paystack's refund id. */
export function fetchPaystackRefund(refundId: string) {
  return paystackRequest<PaystackRefund>('GET', `/refund/${encodeURIComponent(refundId)}`)
}

/** Whether a webhook body really came from Paystack: its HMAC-SHA512 with the secret key. */
export function isValidPaystackSignature(rawBody: Buffer | undefined, signature: unknown): boolean {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret || !rawBody || typeof signature !== 'string') return false
  const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex')
  const given = Buffer.from(signature, 'utf8')
  const wanted = Buffer.from(expected, 'utf8')
  return given.length === wanted.length && crypto.timingSafeEqual(given, wanted)
}
