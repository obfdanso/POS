import type { NextFunction, Request, Response } from 'express'
import * as supplierService from '../services/supplierService'
import type { SupplierInput } from '../services/supplierService'
import { currentUser } from '../middleware/auth'
import { queryInt, queryString } from '../utils/query'

export async function listSuppliers(req: Request, res: Response, next: NextFunction) {
  try {
    const { page = 1, per_page = 50 } = req.query
    const result = await supplierService.listSuppliers({
      page: queryInt(page),
      per_page: queryInt(per_page),
      search: queryString(req.query.search),
    })
    res.status(200).json({ success: true, ...result })
  } catch (err) {
    next(err)
  }
}

export async function getSupplier(req: Request, res: Response, next: NextFunction) {
  try {
    const supplier = await supplierService.getSupplierById(req.params.id, req.branchId)
    res.status(200).json({ success: true, data: supplier })
  } catch (err) {
    next(err)
  }
}

export async function createSupplier(req: Request, res: Response, next: NextFunction) {
  try {
    // Validated by the suppliers route
    const { name, phone, email, address, website } = req.body as SupplierInput & { name: string }
    const supplier = await supplierService.createSupplier({ name, phone, email, address, website })
    res.status(201).json({ success: true, data: supplier, message: 'Supplier created successfully' })
  } catch (err) {
    next(err)
  }
}

export async function updateSupplier(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, phone, email, address, website } = req.body as SupplierInput
    const supplier = await supplierService.updateSupplier(req.params.id, { name, phone, email, address, website })
    res.status(200).json({ success: true, data: supplier, message: 'Supplier updated successfully' })
  } catch (err) {
    next(err)
  }
}

export async function deleteSupplier(req: Request, res: Response, next: NextFunction) {
  try {
    await supplierService.deleteSupplier(req.params.id, currentUser(req).id)
    res.status(200).json({ success: true, message: 'Supplier deleted successfully' })
  } catch (err) {
    next(err)
  }
}
