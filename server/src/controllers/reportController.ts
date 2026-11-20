import type { NextFunction, Request, Response } from 'express'
import * as reportService from '../services/reportService'
import { currentUser } from '../middleware/auth'
import { queryInt, queryString } from '../utils/query'

/** The report's optional date range (validated by the reports route). */
function dateRange(req: Request) {
  return { start_date: queryString(req.query.start_date), end_date: queryString(req.query.end_date) }
}

export async function getSalesSummary(req: Request, res: Response, next: NextFunction) {
  try {
    const { start_date, end_date } = dateRange(req)
    const data = await reportService.getSalesSummary({ start_date, end_date, branchId: req.branchId })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export async function getSalesByDay(req: Request, res: Response, next: NextFunction) {
  try {
    const { start_date, end_date } = dateRange(req)
    const data = await reportService.getSalesByDay({ start_date, end_date, branchId: req.branchId })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export async function getTopProducts(req: Request, res: Response, next: NextFunction) {
  try {
    const { start_date, end_date } = dateRange(req)
    const limit = req.query.limit ?? 10
    const by = queryString(req.query.by) ?? 'revenue'
    const data = await reportService.getTopProducts({ start_date, end_date, limit: queryInt(limit), by, branchId: req.branchId })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export async function getCategoryPerformance(req: Request, res: Response, next: NextFunction) {
  try {
    const { start_date, end_date } = dateRange(req)
    const data = await reportService.getCategoryPerformance({ start_date, end_date, branchId: req.branchId })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export async function getCashierPerformance(req: Request, res: Response, next: NextFunction) {
  try {
    const { start_date, end_date } = dateRange(req)
    const data = await reportService.getCashierPerformance({ start_date, end_date, branchId: req.branchId })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export async function getInventoryStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await reportService.getInventoryStatus(req.branchId)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export async function getProfitReport(req: Request, res: Response, next: NextFunction) {
  try {
    const { start_date, end_date } = dateRange(req)
    const data = await reportService.getProfitReport({ start_date, end_date, branchId: req.branchId })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export async function getDashboardSummary(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await reportService.getDashboardSummary(req.branchId)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export async function getBranchPerformance(req: Request, res: Response, next: NextFunction) {
  try {
    const { start_date, end_date } = dateRange(req)
    const data = await reportService.getBranchPerformance({ start_date, end_date })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export async function getCashierStats(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await reportService.getCashierStats(currentUser(req).id)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

