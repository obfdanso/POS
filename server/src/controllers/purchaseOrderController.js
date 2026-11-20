const service = require('../services/purchaseOrderService')

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res)
  } catch (err) {
    next(err)
  }
}

const listPurchaseOrders = handle(async (req, res) => {
  const page = parseInt(req.query.page) || 1
  const per_page = parseInt(req.query.per_page) || 20
  const { status, supplier_id, search, start_date, end_date, sort, order } = req.query
  const result = await service.listPurchaseOrders({ page, per_page, status, supplier_id, search, start_date, end_date, sort, order, branchId: req.branchId })
  res.json({
    success: true,
    data: result.orders,
    meta: { page: result.page, per_page: result.per_page, total: result.total, total_pages: result.total_pages },
  })
})

const getPurchaseOrder = handle(async (req, res) => {
  res.json({ success: true, data: await service.getPurchaseOrder(req.params.id, req.user) })
})

const createPurchaseOrder = handle(async (req, res) => {
  const po = await service.createPurchaseOrder(req.body, req.user.id, req.branchId)
  res.status(201).json({ success: true, data: po, message: `Purchase order ${po.po_number} created` })
})

const receivePurchaseOrder = handle(async (req, res) => {
  const po = await service.receivePurchaseOrder(req.params.id, req.user, req.body ?? {})
  res.json({ success: true, data: po, message: po.status === 'RECEIVED' ? 'All goods received' : 'Delivery received' })
})

const cancelPurchaseOrder = handle(async (req, res) => {
  const po = await service.cancelPurchaseOrder(req.params.id, req.user, req.body?.reason)
  res.json({ success: true, data: po, message: `Purchase order ${po.po_number} cancelled` })
})

const getReorderSuggestions = handle(async (req, res) => {
  res.json({ success: true, data: await service.getReorderSuggestions(req.query.supplier_id, req.branchId) })
})

module.exports = { listPurchaseOrders, getPurchaseOrder, createPurchaseOrder, receivePurchaseOrder, cancelPurchaseOrder, getReorderSuggestions }
