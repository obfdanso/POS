import type { NextFunction, Request, Response } from 'express'
import * as branchService from '../services/branchService'
import type { BranchChanges, BranchInput } from '../services/branchService'
import { currentUser } from '../middleware/auth'

export async function listBranches(req: Request, res: Response, next: NextFunction) {
  try {
    // Only admins see closed branches and the full details
    const active = req.query.active === 'true' || currentUser(req).role !== 'ADMIN'
    const branches = await branchService.listBranches({ active })
    res.status(200).json({ success: true, data: branches })
  } catch (err) {
    next(err)
  }
}

export async function getBranch(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ success: true, data: await branchService.getBranch(req.params.id) })
  } catch (err) {
    next(err)
  }
}

export async function createBranch(req: Request, res: Response, next: NextFunction) {
  try {
    // Validated by the branches route
    const { name, code, address, phone } = req.body as BranchInput
    const branch = await branchService.createBranch({ name, code, address, phone }, currentUser(req).id)
    res.status(201).json({ success: true, data: branch, message: 'Branch created successfully' })
  } catch (err) {
    next(err)
  }
}

export async function updateBranch(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, code, address, phone, is_active } = req.body as BranchChanges
    const branch = await branchService.updateBranch(req.params.id, { name, code, address, phone, is_active }, currentUser(req).id)
    res.status(200).json({ success: true, data: branch, message: 'Branch updated successfully' })
  } catch (err) {
    next(err)
  }
}
