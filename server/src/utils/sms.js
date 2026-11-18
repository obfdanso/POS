// Text messages through Arkesel (Ghana) or Twilio. SMS is optional: it is on only when
// SMS_PROVIDER and that provider's credentials are set.

const TIMEOUT_MS = 10000

function smsProvider() {
  const provider = (process.env.SMS_PROVIDER || '').trim().toLowerCase()
  if (provider === 'arkesel' && process.env.ARKESEL_API_KEY && process.env.SMS_SENDER_ID) return 'arkesel'
  if (provider === 'twilio' && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) return 'twilio'
  return null
}

function isSmsConfigured() {
  return smsProvider() !== null
}

/**
 * A phone number in international form (+233241234567), or null if it isn't one. Local numbers
 * starting with 0 (024-123-4567) get SMS_COUNTRY_CODE, default 233 (Ghana).
 */
function normalizePhone(raw, countryCode = process.env.SMS_COUNTRY_CODE || '233') {
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

async function readJson(res) {
  try {
    return await res.json()
  } catch {
    return null
  }
}

/** Sends `message` to `to` (international form). Throws if the provider doesn't accept it. */
async function sendSms(to, message) {
  const provider = smsProvider()
  if (provider === 'arkesel') {
    const res = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
      method: 'POST',
      headers: { 'api-key': process.env.ARKESEL_API_KEY, 'Content-Type': 'application/json' },
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
    const sid = process.env.TWILIO_ACCOUNT_SID
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM, Body: message }).toString(),
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

module.exports = { isSmsConfigured, normalizePhone, sendSms }
