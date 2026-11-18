const salesService = require('../services/salesService')
const gatewayRefundService = require('../services/gatewayRefundService')

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
    const sale = await salesService.createSale(req.body, req.user)
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
      sort: req.query.sort, order: req.query.order,
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
    if (req.user.role === 'CASHIER' && sale.user_id !== req.user.id) {
      const { ForbiddenError } = require('../utils/errors')
      throw new ForbiddenError('You can only view your own sales')
    }
    res.json({ success: true, data: normalizeSale(sale) })
  } catch (err) {
    next(err)
  }
}

async function processRefund(req, res, next) {
  try {
    const { items, reason } = req.body ?? {}
    const sale = await salesService.processRefund(req.params.id, req.user.id, { items, reason })
    res.json({ success: true, data: normalizeSale(sale), message: 'Refund processed successfully' })
  } catch (err) {
    next(err)
  }
}

async function getReceipt(req, res, next) {
  try {
    const data = await salesService.getReceiptData(req.params.id)
    if (req.user.role === 'CASHIER' && data.sale.user_id !== req.user.id) {
      const { ForbiddenError } = require('../utils/errors')
      throw new ForbiddenError('You can only view receipts for your own sales')
    }
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

async function emailReceipt(req, res, next) {
  try {
    const sale = await salesService.getSaleById(req.params.id)
    if (req.user.role === 'CASHIER' && sale.user_id !== req.user.id) {
      const { ForbiddenError } = require('../utils/errors')
      throw new ForbiddenError('You can only email receipts for your own sales')
    }
    const { to } = await salesService.emailReceipt(sale, req.user.id, req.body?.email)
    res.json({ success: true, data: { to }, message: `Receipt sent to ${to}` })
  } catch (err) {
    next(err)
  }
}

async function smsReceipt(req, res, next) {
  try {
    const sale = await salesService.getSaleById(req.params.id)
    if (req.user.role === 'CASHIER' && sale.user_id !== req.user.id) {
      const { ForbiddenError } = require('../utils/errors')
      throw new ForbiddenError('You can only text receipts for your own sales')
    }
    const { to } = await salesService.smsReceipt(sale, req.user.id, req.body?.phone)
    res.json({ success: true, data: { to }, message: `Receipt texted to ${to}` })
  } catch (err) {
    next(err)
  }
}

async function sendRefundToPaystack(req, res, next) {
  try {
    await gatewayRefundService.sendOrRefreshGatewayRefund(req.params.id, req.params.refundId, req.user.id)
    const sale = await salesService.getSaleById(req.params.id)
    res.json({ success: true, data: normalizeSale(sale) })
  } catch (err) {
    next(err)
  }
}

module.exports = { createSale, listSales, getSale, processRefund, getReceipt, emailReceipt, smsReceipt, sendRefundToPaystack }
