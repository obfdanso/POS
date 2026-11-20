import type { ShiftStatus } from '@prisma/client'
import type { NextFunction, Request, Response } from 'express'
import * as shiftService from '../services/shiftService'
import { currentUser } from '../middleware/auth'
import { actingBranchId } from '../middleware/branch'
import { queryInt, queryString } from '../utils/query'

/** Validated by the shifts routes. */
interface OpenShiftBody {
  opening_float: number
  notes?: string | null
}

interface CloseShiftBody {
  counted_cash: number
  notes?: string | null
}

export async function getCurrentShift(req: Request, res: Response, next: NextFunction) {
  try {
    const shift = await shiftService.getCurrentShift(currentUser(req).id)
    res.json({ success: true, data: shift })
  } catch (err) {
    next(err)
  }
}

export async function openShift(req: Request, res: Response, next: NextFunction) {
  try {
    const shift = await shiftService.openShift(currentUser(req).id, req.body as OpenShiftBody, actingBranchId(req))
    res.status(201).json({ success: true, data: shift, message: 'Shift opened' })
  } catch (err) {
    next(err)
  }
}

export async function closeShift(req: Request, res: Response, next: NextFunction) {
  try {
    const shift = await shiftService.closeShift(req.params.id, currentUser(req), req.body as CloseShiftBody)
    res.json({ success: true, data: shift, message: 'Shift closed' })
  } catch (err) {
    next(err)
  }
}

export async function getShift(req: Request, res: Response, next: NextFunction) {
  try {
    const shift = await shiftService.getShift(req.params.id, currentUser(req))
    res.json({ success: true, data: shift })
  } catch (err) {
    next(err)
  }
}

export async function listShifts(req: Request, res: Response, next: NextFunction) {
  try {
    const user = currentUser(req)
    const page = queryInt(req.query.page) || 1
    const per_page = queryInt(req.query.per_page) || 20
    // Cashiers only see their own shifts
    const user_id = user.role === 'CASHIER' ? user.id : queryString(req.query.user_id)

    const result = await shiftService.listShifts({
      page,
      per_page,
      user_id,
      // The route only lets OPEN or CLOSED through
      status: queryString(req.query.status) as ShiftStatus | undefined,
      start_date: queryString(req.query.start_date),
      end_date: queryString(req.query.end_date),
      sort: queryString(req.query.sort),
      order: queryString(req.query.order),
      branchId: req.branchId,
    })
    const shifts = result.shifts.map(({ _count, ...s }) => ({ ...s, sales_count: _count?.sales ?? 0 }))
    res.json({
      success: true,
      data: shifts,
      meta: { page: result.page, per_page: result.per_page, total: result.total, total_pages: result.total_pages },
    })
  } catch (err) {
    next(err)
  }
}
