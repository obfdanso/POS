// Text messages through Arkesel (Ghana) or Twilio. SMS is optional: it is on only when
// SMS_PROVIDER and that provider's credentials are set.

const TIMEOUT_MS = 10000

type SmsProvider = 'arkesel' | 'twilio'

function smsProvider(): SmsProvider | null {
  const provider = (process.env.SMS_PROVIDER || '').trim().toLowerCase()
  if (provider === 'arkesel' && process.env.ARKESEL_API_KEY && process.env.SMS_SENDER_ID) return 'arkesel'
  if (provider === 'twilio' && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) return 'twilio'
  return null
}

export function isSmsConfigured(): boolean {
  return smsProvider() !== null
}

/**
 * A phone number in international form (+233241234567), or null if it isn't one. Local numbers
 * starting with 0 (024-123-4567) get SMS_COUNTRY_CODE, default 233 (Ghana).
 */
export function normalizePhone(raw: unknown, countryCode = process.env.SMS_COUNTRY_CODE || '233'): string | null {
  const compact = String(raw ?? '').trim().replace(/[\s\-().]/g, '')
  if (!/^\+?\d+$/.test(compact)) return null
  let digits
  if (compact.startsWith('+')) digits = compact.slice(1)
  else if (compact.startsWith('00')) digits = compact.slice(2)
  else if (compact.startsWith('0')) digits = countryCode + compact.slice(1)
  else digits = compact.startsWith(countryCode) ? compact : countryCode + compact
  if (digits.length < 10 || digits.length > 15) return null
  // Ghanaian mobile numbers are always 9 digits after the country code
  if (digits.startsWith('233') && digits.length !== 12) return null
  return `+${digits}`
}

/**
 * Whether texts may go to this number. Texts cost money, so by default only numbers in
 * SMS_COUNTRY_CODE are allowed; SMS_ALLOWED_COUNTRY_CODES (e.g. "233,234") widens that.
 */
export function isAllowedDestination(phone: string): boolean {
  const allowed = (process.env.SMS_ALLOWED_COUNTRY_CODES || process.env.SMS_COUNTRY_CODE || '233')
    .split(',')
    .map((c) => c.trim().replace(/^\+/, ''))
    .filter(Boolean)
  const digits = String(phone).replace(/^\+/, '')
  return allowed.some((code) => digits.startsWith(code))
}

/** The parts of a provider's JSON reply that are read here. */
interface ProviderReply {
  status?: unknown
  message?: unknown
}

async function readJson(res: Response): Promise<ProviderReply | null> {
  try {
    const body: unknown = await res.json()
    return body && typeof body === 'object' ? body : null
  } catch {
    return null
  }
}

/** Sends `message` to `to` (international form). Throws if the provider doesn't accept it. */
export async function sendSms(to: string, message: string): Promise<void> {
  const provider = smsProvider()
  if (provider === 'arkesel') {
    const res = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
      method: 'POST',
      headers: { 'api-key': process.env.ARKESEL_API_KEY ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: process.env.SMS_SENDER_ID, message, recipients: [to.replace(/^\+/, '')] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await readJson(res)
    if (!res.ok || body?.status !== 'success') {
      throw new Error(`Arkesel rejected the message (HTTP ${res.status}${body?.message ? `: ${body.message}` : ''})`)
    }
    return
  }
  if (provider === 'twilio') {
    const sid = process.env.TWILIO_ACCOUNT_SID ?? ''
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM ?? '', Body: message }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      const body = await readJson(res)
      throw new Error(`Twilio rejected the message (HTTP ${res.status}${body?.message ? `: ${body.message}` : ''})`)
    }
    return
  }
  throw new Error('SMS is not configured')
}
