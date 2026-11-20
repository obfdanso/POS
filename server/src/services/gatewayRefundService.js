// Sends the card and Mobile Money part of refunds back through Paystack's refund API.
//
// A refund is first recorded (NOT_SENT) in the same transaction as the return, then sent once that
// has committed, so a database failure can never leave money refunded with no record of it. The
// row is claimed (NOT_SENT/FAILED → PENDING) before calling Paystack, so it can't be sent twice
// at once. Paystack refunds take time: it reports progress through its webhook or a status check.

const prisma = require('../utils/prismaClient').default
const { refundPaystackPayment, fetchPaystackRefund } = require('../utils/paystack')
const { recordAudit } = require('../utils/audit')
const { logger } = require('../middleware/logger')
const { AppError, ConflictError, NotFoundError, ValidationError } = require('../utils/errors')

const PAYSTACK_STATUS = { pending: 'PENDING', processing: 'PROCESSING', processed: 'PROCESSED', failed: 'FAILED' }

/** Paystack refunds are sent automatically when a secret key is set, unless turned off. */
function autoRefundsEnabled() {
  return Boolean(process.env.PAYSTACK_SECRET_KEY) && process.env.PAYSTACK_AUTO_REFUND !== 'false'
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Works out the Paystack part of a new refund, inside the refund's transaction: how much, and which
 * charge it goes back to (one with enough left that earlier refunds haven't claimed). Returns the
 * Refund columns to set, or {} when nothing goes back through Paystack.
 */
async function planGatewayRefund(tx, sale, amount, cashAmount) {
  const gatewayAmount = round2(amount - cashAmount)
  if (sale.payment_method === 'CASH' || gatewayAmount <= 0) return {}

  const charges = sale.payments.filter((p) => p.method !== 'CASH' && p.reference)
  // No Paystack charge to go back to (e.g. recorded before Paystack was used): nothing to send
  if (charges.length === 0) return {}
  for (const charge of charges) {
    const claimed = await tx.refund.aggregate({ where: { gateway_reference: charge.reference }, _sum: { gateway_amount: true } })
    const left = round2(parseFloat(charge.amount_paid) - parseFloat(claimed._sum.gateway_amount || 0))
    if (left >= gatewayAmount) {
      return { gateway_status: 'NOT_SENT', gateway_amount: gatewayAmount, gateway_reference: charge.reference }
    }
  }
  // e.g. one return spread over a card and a Mobile Money charge: done by hand in the dashboard
  return {
    gateway_status: 'NOT_SENT',
    gateway_amount: gatewayAmount,
    gateway_reference: null,
    gateway_error: 'Send this back from the Paystack dashboard: no single charge covers it',
  }
}

// Paystack's states only move forward (PENDING → PROCESSING → PROCESSED or FAILED), so a late or
// repeated update can never undo a newer one
const MOVES_FROM = {
  PENDING: [],
  PROCESSING: ['PENDING'],
  PROCESSED: ['PENDING', 'PROCESSING'],
  FAILED: ['PENDING', 'PROCESSING'],
}

// A send that never finished (the server stopped mid-call) shows as PENDING with no Paystack id
const STALE_SEND_MS = 2 * 60 * 1000

async function advanceStatus(refundId, status, extra = {}) {
  if (!MOVES_FROM[status]?.length) return false
  const { count } = await prisma.refund.updateMany({
    where: { id: refundId, gateway_status: { in: MOVES_FROM[status] } },
    data: { gateway_status: status, ...extra },
  })
  return count > 0
}

/**
 * Sends one recorded refund to Paystack. Returns false if it was not waiting to be sent (another
 * request got there first, or it has no charge to go back to).
 */
async function sendGatewayRefund(refundId, userId) {
  const claimed = await prisma.refund.updateMany({
    where: { id: refundId, gateway_status: { in: ['NOT_SENT', 'FAILED'] }, gateway_reference: { not: null } },
    data: { gateway_status: 'PENDING', gateway_error: null },
  })
  if (claimed.count === 0) return false

  const refund = await prisma.refund.findUnique({ where: { id: refundId }, include: { sale: { select: { transaction_id: true } } } })
  const pesewas = Math.round(parseFloat(refund.gateway_amount) * 100)
  let outcome
  try {
    const res = await refundPaystackPayment(refund.gateway_reference, pesewas, `Return for ${refund.sale.transaction_id}`)
    if (res?.status === true) {
      const paystackId = res.data?.id === undefined || res.data?.id === null ? null : String(res.data.id)
      // Without an id it can't be checked on from here, and must never be sent again by mistake
      await prisma.refund.update({
        where: { id: refundId },
        data: paystackId
          ? { gateway_refund_id: paystackId }
          : { gateway_error: 'Paystack accepted the refund; follow it in the Paystack dashboard' },
      })
      outcome = PAYSTACK_STATUS[res.data?.status] ?? 'PENDING'
      // A webhook may already have moved it on; only ever go forward
      await advanceStatus(refundId, outcome)
    } else {
      outcome = 'FAILED'
      await prisma.refund.updateMany({
        where: { id: refundId, gateway_status: 'PENDING' },
        data: { gateway_status: 'FAILED', gateway_error: String(res?.message || 'Paystack refused the refund').slice(0, 300) },
      })
    }
  } catch (err) {
    // Paystack may still have received it, so say to look before trying again
    outcome = 'FAILED'
    logger.error(`Paystack refund ${refundId} failed: ${err.message}`)
    await prisma.refund.updateMany({
      where: { id: refundId, gateway_status: 'PENDING', gateway_refund_id: null },
      data: {
        gateway_status: 'FAILED',
        gateway_error: `${err instanceof AppError ? err.message : 'Paystack could not be reached'}. Check the Paystack dashboard before trying again.`,
      },
    })
  }
  await recordAudit({
    userId,
    action: outcome === 'FAILED' ? 'PAYSTACK_REFUND_FAILED' : 'PAYSTACK_REFUND_SENT',
    entity: 'Refund',
    entityId: refundId,
    details: `${refund.sale.transaction_id}: ${parseFloat(refund.gateway_amount).toFixed(2)} to ${refund.gateway_reference}`,
  })
  return true
}

/** Asks Paystack how a sent refund is going and records the answer. */
async function refreshGatewayRefund(refund) {
  const res = await fetchPaystackRefund(refund.gateway_refund_id)
  const status = res?.status === true ? PAYSTACK_STATUS[res.data?.status] : null
  if (!status) throw new AppError('Paystack did not return the refund status. Try again shortly.', 502, 'PAYSTACK_ERROR')
  await advanceStatus(refund.id, status, status === 'FAILED' ? { gateway_error: 'Paystack could not complete the refund' } : {})
}

/**
 * The manager's button on a refund: sends it if it hasn't gone (or failed), otherwise checks on it.
 */
async function sendOrRefreshGatewayRefund(saleId, refundId, userId) {
  const refund = await prisma.refund.findFirst({ where: { id: refundId, sale_id: saleId } })
  if (!refund) throw new NotFoundError('Refund not found')
  if (!refund.gateway_status) {
    throw new ValidationError('Nothing to send', [{ field: 'refund', message: 'This refund was paid in cash or recorded by hand' }])
  }
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new AppError('Paystack is not set up on this server', 503, 'PAYSTACK_NOT_CONFIGURED')
  }

  if (['NOT_SENT', 'FAILED'].includes(refund.gateway_status)) {
    if (!refund.gateway_reference) {
      throw new ValidationError('Send it from Paystack', [{ field: 'refund', message: refund.gateway_error || 'Send this refund from the Paystack dashboard' }])
    }
    if (!(await sendGatewayRefund(refund.id, userId))) throw new ConflictError('This refund is already being sent')
  } else if (['PENDING', 'PROCESSING'].includes(refund.gateway_status)) {
    if (refund.gateway_refund_id) {
      await refreshGatewayRefund(refund)
    } else if (!refund.gateway_error && Date.now() - new Date(refund.updated_at).getTime() > STALE_SEND_MS) {
      // Sending was cut off before Paystack answered: let it be retried, after a look at the dashboard
      await prisma.refund.updateMany({
        where: { id: refund.id, gateway_status: 'PENDING', gateway_refund_id: null, updated_at: refund.updated_at },
        data: { gateway_status: 'FAILED', gateway_error: 'Sending was interrupted. Check the Paystack dashboard before trying again.' },
      })
    } else if (!refund.gateway_error) {
      throw new ConflictError('This refund is already being sent')
    }
  }
  return prisma.refund.findUnique({ where: { id: refund.id } })
}

/**
 * Applies a refund.* webhook event from Paystack. The refund is matched by Paystack's refund id
 * when the event has one, otherwise by the charge reference and amount (the oldest open match).
 * Unknown refunds are ignored.
 */
async function applyRefundWebhook(event) {
  const name = String(event?.event || '')
  const status = name.startsWith('refund.') ? PAYSTACK_STATUS[name.slice('refund.'.length)] : null
  const data = event?.data || {}
  if (!status || !MOVES_FROM[status].length) return false

  let match
  if (data.id !== undefined && data.id !== null) {
    match = { gateway_refund_id: String(data.id) }
  } else if (data.transaction_reference) {
    match = {
      gateway_reference: String(data.transaction_reference),
      ...(Number.isFinite(Number(data.amount)) && { gateway_amount: Number(data.amount) / 100 }),
    }
  } else {
    return false
  }
  const refund = await prisma.refund.findFirst({
    where: { ...match, gateway_status: { in: MOVES_FROM[status] } },
    orderBy: { created_at: 'asc' },
    select: { id: true },
  })
  if (!refund) return false
  return advanceStatus(refund.id, status, status === 'FAILED' ? { gateway_error: 'Paystack could not complete the refund' } : {})
}

module.exports = { autoRefundsEnabled, planGatewayRefund, sendGatewayRefund, sendOrRefreshGatewayRefund, applyRefundWebhook }
