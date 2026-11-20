import type { NextFunction, Request, Response } from 'express'
import * as service from '../services/promotionService'
import type { PromotionInput } from '../services/promotionService'
import { currentUser } from '../middleware/auth'
import { queryString } from '../utils/query'

const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    await fn(req, res)
  } catch (err) {
    next(err)
  }
}

export const listActive = handle(async (req, res) => res.json({ success: true, data: await service.listActivePromotions() }))
export const list = handle(async (req, res) => res.json({ success: true, data: await service.listPromotions({ status: queryString(req.query.status) }) }))
export const get = handle(async (req, res) => res.json({ success: true, data: await service.getPromotion(req.params.id) }))
export const create = handle(async (req, res) => {
  // Validated by the promotions route
  const promo = await service.createPromotion(req.body as PromotionInput & { name: string; percent_off: number }, currentUser(req).id)
  res.status(201).json({ success: true, data: promo, message: 'Promotion created' })
})
export const update = handle(async (req, res) => {
  const promo = await service.updatePromotion(req.params.id, req.body as PromotionInput, currentUser(req).id)
  res.json({ success: true, data: promo, message: 'Promotion updated' })
})
