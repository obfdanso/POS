const salesService = require('../services/salesService')
const gatewayRefundService = require('../services/gatewayRefundService')
const { recordAudit } = require('../utils/audit')
const { NotFoundError } = require('../utils/errors')

const without = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([key]) => !keys.includes(key)))

function normalizeSale(sale) {
  return {
    ...sale,
    items: sale.sale_items ?? [],
    // The cash part first when there is one; split sales list every part in `payments`
    payment: sale.payments?.[0] ?? null,
    payments: sale.payments ?? [],
    sale_items: undefined,
  }
}

async function createSale(req, res, next) {
  try {
    const sale = await salesService.createSale(req.body, req.user, req.branchId)
    res.status(201).json({ success: true, data: normalizeSale(sale), message: 'Sale processed successfully' })
  } catch (err) {
    next(err)
  }
}

async function listSales(req, res, next) {
  try {
    const page = parseInt(req.query.page) || 1
    const per_page = parseInt(req.query.per_page) || 20
    const { start_date, end_date, customer_id, payment_status, payment_method, search } = req.query

    // Cashiers can only see their own sales
    const user_id = req.user.role === 'CASHIER' ? req.user.id : req.query.user_id

    const result = await salesService.listSales({
      page, per_page, start_date, end_date, user_id, customer_id, payment_status, payment_method, search,
      sort: req.query.sort, order: req.query.order, branchId: req.branchId,
    })
    const sales = result.sales.map(({ _count, ...s }) => ({ ...s, items_count: _count?.sale_items ?? 0 }))
    res.json({
      success: true,
      data: sales,
      meta: { page: result.page, per_page: result.per_page, total: result.total, total_pages: result.total_pages },
    })
  } catch (err) {
    next(err)
  }
}

async function getSale(req, res, next) {
  try {
    const sale = await salesService.getSaleById(req.params.id)
    salesService.assertCanSeeSale(sale, req.user)
    res.json({ success: true, data: normalizeSale(sale) })
  } catch (err) {
    next(err)
  }
}

/**
 * Any branch's sale, by its receipt number, so a return can be made at another branch. Only what a
 * return needs comes back: the customer's name but not their contact details, and no payment
 * references. Each lookup is recorded in the audit trail.
 */
async function lookupSale(req, res, next) {
  try {
    const sale = await salesService.getSaleByTransactionId(req.params.transactionId)
    await recordAudit({ userId: req.user.id, action: 'SALE_LOOKUP', entity: 'Sale', entityId: sale.id, details: sale.transaction_id })
    const trimmed = {
      ...sale,
      customer: sale.customer && { id: sale.customer.id, name: sale.customer.name },
      payments: sale.payments.map((payment) => without(payment, ['reference'])),
      refunds: sale.refunds.map((refund) => without(refund, ['gateway_reference', 'gateway_refund_id', 'gateway_error'])),
    }
    res.json({ success: true, data: normalizeSale(trimmed) })
  } catch (err) {
    next(err)
  }
}

async function processRefund(req, res, next) {
  try {
    const { items, reason } = req.body ?? {}
    const sale = await salesService.processRefund(req.params.id, req.user.id, { items, reason }, req.branchId)
    res.json({ success: true, data: normalizeSale(sale), message: 'Refund processed successfully' })
  } catch (err) {
    next(err)
  }
}

async function getReceipt(req, res, next) {
  try {
    const data = await salesService.getReceiptData(req.params.id)
    salesService.assertCanSeeSale(data.sale, req.user, 'You can only view receipts for your own sales')
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

async function emailReceipt(req, res, next) {
  try {
    const sale = await salesService.getSaleById(req.params.id)
    salesService.assertCanSeeSale(sale, req.user, 'You can only email receipts for your own sales')
    const { to } = await salesService.emailReceipt(sale, req.user.id, req.body?.email)
    res.json({ success: true, data: { to }, message: `Receipt sent to ${to}` })
  } catch (err) {
    next(err)
  }
}

async function smsReceipt(req, res, next) {
  try {
    const sale = await salesService.getSaleById(req.params.id)
    salesService.assertCanSeeSale(sale, req.user, 'You can only text receipts for your own sales')
    const { to } = await salesService.smsReceipt(sale, req.user.id, req.body?.phone)
    res.json({ success: true, data: { to }, message: `Receipt texted to ${to}` })
  } catch (err) {
    next(err)
  }
}

async function sendRefundToPaystack(req, res, next) {
  try {
    // Only staff who may see the sale, and for managers only refunds their own branch paid out
    const before = await salesService.getSaleById(req.params.id)
    salesService.assertCanSeeSale(before, req.user)
    const refund = before.refunds.find((r) => r.id === req.params.refundId)
    if (req.user.role === 'MANAGER' && refund && refund.branch_id !== req.user.branch_id) {
      throw new NotFoundError('Refund not found')
    }
    await gatewayRefundService.sendOrRefreshGatewayRefund(req.params.id, req.params.refundId, req.user.id)
    const sale = await salesService.getSaleById(req.params.id)
    res.json({ success: true, data: normalizeSale(sale) })
  } catch (err) {
    next(err)
  }
}

module.exports = { createSale, listSales, getSale, lookupSale, processRefund, getReceipt, emailReceipt, smsReceipt, sendRefundToPaystack }
