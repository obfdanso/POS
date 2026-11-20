import type { NextFunction, Request, Response } from 'express'
import * as inventoryService from '../services/inventoryService'
import { currentUser } from '../middleware/auth'
import { actingBranchId } from '../middleware/branch'
import { queryInt, queryString } from '../utils/query'

/** Validated by the inventory routes. */
interface AdjustBody {
  product_id: string
  quantity_change: number
  notes?: string
}

interface RestockBody {
  product_id: string
  quantity: number
  notes?: string
}

export async function listInventory(req: Request, res: Response, next: NextFunction) {
  try {
    const page = queryInt(req.query.page) || 1
    const per_page = queryInt(req.query.per_page) || 20
    const search = queryString(req.query.search)
    const status = queryString(req.query.status)

    const result = await inventoryService.listInventory({
      page, per_page, search, status, sort: queryString(req.query.sort), order: queryString(req.query.order), branchId: req.branchId,
    })

    res.json({
      success: true,
      data: result.products,
      meta: { page: result.page, per_page: result.per_page, total: result.total, total_pages: result.total_pages },
    })
  } catch (err) {
    next(err)
  }
}

export async function getLowStock(req: Request, res: Response, next: NextFunction) {
  try {
    const items = await inventoryService.getLowStock(req.branchId)
    res.json({ success: true, data: items })
  } catch (err) {
    next(err)
  }
}

export async function adjustStock(req: Request, res: Response, next: NextFunction) {
  try {
    const { product_id, quantity_change, notes } = req.body as AdjustBody
    const result = await inventoryService.adjustStock(
      product_id,
      quantity_change,
      'ADJUSTMENT',
      currentUser(req).id,
      notes,
      actingBranchId(req)
    )
    res.json({ success: true, data: result, message: 'Stock adjusted successfully' })
  } catch (err) {
    next(err)
  }
}

export async function restockProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const { product_id, quantity, notes } = req.body as RestockBody
    const result = await inventoryService.restockProduct(product_id, quantity, currentUser(req).id, notes, actingBranchId(req))
    res.json({ success: true, data: result, message: 'Product restocked successfully' })
  } catch (err) {
    next(err)
  }
}

export async function getInventoryLog(req: Request, res: Response, next: NextFunction) {
  try {
    const page = queryInt(req.query.page) || 1
    const per_page = queryInt(req.query.per_page) || 20
    const result = await inventoryService.getInventoryLog(req.params.productId, { page, per_page, branchId: req.branchId })
    res.json({
      success: true,
      data: result.logs,
      meta: { page: result.page, per_page: result.per_page, total: result.total, total_pages: result.total_pages },
    })
  } catch (err) {
    next(err)
  }
}
