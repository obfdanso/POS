import type { NextFunction, Request, Response } from 'express'
import * as customerService from '../services/customerService'
import type { CustomerInput } from '../services/customerService'
import { currentUser } from '../middleware/auth'
import { queryInt, queryString } from '../utils/query'

export async function listCustomers(req: Request, res: Response, next: NextFunction) {
  try {
    const page = queryInt(req.query.page) || 1
    const per_page = queryInt(req.query.per_page) || 20
    const search = queryString(req.query.search)
    const result = await customerService.listCustomers({
      page, per_page, search, sort: queryString(req.query.sort), order: queryString(req.query.order),
    })
    res.json({
      success: true,
      data: result.customers,
      meta: { page: result.page, per_page: result.per_page, total: result.total, total_pages: result.total_pages },
    })
  } catch (err) {
    next(err)
  }
}

export async function getCustomer(req: Request, res: Response, next: NextFunction) {
  try {
    const customer = await customerService.getCustomerById(req.params.id)
    res.json({ success: true, data: customer })
  } catch (err) {
    next(err)
  }
}

export async function createCustomer(req: Request, res: Response, next: NextFunction) {
  try {
    // Validated by the customers route
    const customer = await customerService.createCustomer(req.body as CustomerInput)
    res.status(201).json({ success: true, data: customer, message: 'Customer created successfully' })
  } catch (err) {
    next(err)
  }
}

export async function updateCustomer(req: Request, res: Response, next: NextFunction) {
  try {
    const customer = await customerService.updateCustomer(req.params.id, req.body as Partial<CustomerInput>)
    res.json({ success: true, data: customer, message: 'Customer updated successfully' })
  } catch (err) {
    next(err)
  }
}

export async function getCustomerPurchases(req: Request, res: Response, next: NextFunction) {
  try {
    const user = currentUser(req)
    const page = queryInt(req.query.page) || 1
    const per_page = queryInt(req.query.per_page) || 20
    const result = await customerService.getCustomerPurchases(req.params.id, {
      page,
      per_page,
      // Cashiers can only view their own sales
      userId: user.role === 'CASHIER' ? user.id : undefined,
      // Managers don't get other branches' sale ids (returns there go through the receipt lookup)
      branchId: user.role === 'MANAGER' ? user.branch_id : undefined,
    })
    const sales = result.sales.map((s) => ({
      ...s,
      items_count: s._count?.sale_items ?? 0,
      _count: undefined,
    }))
    res.json({
      success: true,
      data: sales,
      meta: { page: result.page, per_page: result.per_page, total: result.total, total_pages: result.total_pages },
    })
  } catch (err) {
    next(err)
  }
}
