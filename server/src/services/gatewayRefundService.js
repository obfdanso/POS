// Sends the card and Mobile Money part of refunds back through Paystack's refund API.
//
// A refund is first recorded (NOT_SENT) in the same transaction as the return, then sent once that
// has committed, so a database failure can never leave money refunded with no record of it. The
// row is claimed (NOT_SENT/FAILED → PENDING) before calling Paystack, so it can't be sent twice
// at once. Paystack refunds take time: it reports progress through its webhook or a status check.

const prisma = require('../utils/prismaClient')
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
  let update
  try {
    const res = await refundPaystackPayment(refund.gateway_reference, pesewas, `Return for ${refund.sale.transaction_id}`)
    if (res?.status === true) {
      update = {
        gateway_status: PAYSTACK_STATUS[res.data?.status] ?? 'PENDING',
        gateway_refund_id: res.data?.id === undefined || res.data?.id === null ? null : String(res.data.id),
      }
    } else {
      update = { gateway_status: 'FAILED', gateway_error: String(res?.message || 'Paystack refused the refund').slice(0, 300) }
    }
  } catch (err) {
    // Paystack may still have received it, so say to look before trying again
    update = {
      gateway_status: 'FAILED',
      gateway_error: `${err instanceof AppError ? err.message : 'Paystack could not be reached'}. Check the Paystack dashboard before trying again.`,
    }
    logger.error(`Paystack refund ${refundId} failed: ${err.message}`)
  }
  await prisma.refund.update({ where: { id: refundId }, data: update })
  await recordAudit({
    userId,
    action: update.gateway_status === 'FAILED' ? 'PAYSTACK_REFUND_FAILED' : 'PAYSTACK_REFUND_SENT',
    entity: 'Refund',
    entityId: refundId,
    details: `${refund.sale.transaction_id}: ${parseFloat(refund.gateway_amount).toFixed(2)} to ${refund.gateway_reference}${update.gateway_error ? ` (${update.gateway_error})` : ''}`,
  })
  return true
}

/** Asks Paystack how a sent refund is going and records the answer. */
async function refreshGatewayRefund(refund) {
  const res = await fetchPaystackRefund(refund.gateway_refund_id)
  const status = res?.status === true ? PAYSTACK_STATUS[res.data?.status] : null
  if (!status) throw new AppError('Paystack did not return the refund status. Try again shortly.', 502, 'PAYSTACK_ERROR')
  if (status !== refund.gateway_status) {
    await prisma.refund.update({ where: { id: refund.id }, data: { gateway_status: status } })
  }
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
    // Pending with no Paystack id yet: another request is sending it right now
    if (!refund.gateway_refund_id) throw new ConflictError('This refund is already being sent')
    await refreshGatewayRefund(refund)
  }
  return prisma.refund.findUnique({ where: { id: refund.id } })
}

/** Applies a refund.* webhook event from Paystack. Unknown refunds are ignored. */
async function applyRefundWebhook(event) {
  const status = PAYSTACK_STATUS[String(event?.event || '').replace(/^refund\./, '')]
  const id = event?.data?.id
  if (!String(event?.event || '').startsWith('refund.') || !status || id === undefined || id === null) return false
  const { count } = await prisma.refund.updateMany({
    // A late "pending" must not undo a "processed" that arrived first
    where: { gateway_refund_id: String(id), NOT: { gateway_status: 'PROCESSED' } },
    data: { gateway_status: status, ...(status === 'FAILED' && { gateway_error: 'Paystack could not complete the refund' }) },
  })
  return count > 0
}

module.exports = { autoRefundsEnabled, planGatewayRefund, sendGatewayRefund, sendOrRefreshGatewayRefund, applyRefundWebhook }
