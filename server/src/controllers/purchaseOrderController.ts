import type { PurchaseOrderStatus } from '@prisma/client'
import type { NextFunction, Request, Response } from 'express'
import * as service from '../services/purchaseOrderService'
import type { PurchaseOrderInput, ReceiveInput } from '../services/purchaseOrderService'
import { currentUser } from '../middleware/auth'
import { actingBranchId } from '../middleware/branch'
import { queryInt, queryString } from '../utils/query'

const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    await fn(req, res)
  } catch (err) {
    next(err)
  }
}

export const listPurchaseOrders = handle(async (req, res) => {
  const page = queryInt(req.query.page) || 1
  const per_page = queryInt(req.query.per_page) || 20
  const result = await service.listPurchaseOrders({
    page,
    per_page,
    // The route only lets a real status through
    status: queryString(req.query.status) as PurchaseOrderStatus | undefined,
    supplier_id: queryString(req.query.supplier_id),
    search: queryString(req.query.search),
    start_date: queryString(req.query.start_date),
    end_date: queryString(req.query.end_date),
    sort: queryString(req.query.sort),
    order: queryString(req.query.order),
    branchId: req.branchId,
  })
  res.json({
    success: true,
    data: result.orders,
    meta: { page: result.page, per_page: result.per_page, total: result.total, total_pages: result.total_pages },
  })
})

export const getPurchaseOrder = handle(async (req, res) => {
  res.json({ success: true, data: await service.getPurchaseOrder(req.params.id, currentUser(req)) })
})

export const createPurchaseOrder = handle(async (req, res) => {
  // Validated by the purchase orders route
  const po = await service.createPurchaseOrder(req.body as PurchaseOrderInput, currentUser(req).id, actingBranchId(req))
  res.status(201).json({ success: true, data: po, message: `Purchase order ${po.po_number} created` })
})

export const receivePurchaseOrder = handle(async (req, res) => {
  const po = await service.receivePurchaseOrder(req.params.id, currentUser(req), (req.body as ReceiveInput | undefined) ?? {})
  res.json({ success: true, data: po, message: po.status === 'RECEIVED' ? 'All goods received' : 'Delivery received' })
})

export const cancelPurchaseOrder = handle(async (req, res) => {
  const body = req.body as { reason?: string | null } | undefined
  const po = await service.cancelPurchaseOrder(req.params.id, currentUser(req), body?.reason)
  res.json({ success: true, data: po, message: `Purchase order ${po.po_number} cancelled` })
})

export const getReorderSuggestions = handle(async (req, res) => {
  // The route requires a supplier_id
  res.json({ success: true, data: await service.getReorderSuggestions(String(req.query.supplier_id), actingBranchId(req)) })
})
