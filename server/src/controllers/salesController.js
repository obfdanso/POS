const salesService = require('../services/salesService')

function normalizeSale(sale) {
  return {
    ...sale,
    items: sale.sale_items ?? [],
    payment: sale.payments?.[0] ?? null,
    sale_items: undefined,
    payments: undefined,
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
    const sale = await salesService.processRefund(req.params.id, req.user.id)
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

module.exports = { createSale, listSales, getSale, processRefund, getReceipt }
