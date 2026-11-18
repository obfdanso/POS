const service = require('../services/promotionService')

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res)
  } catch (err) {
    next(err)
  }
}

module.exports = {
  listActive: handle(async (req, res) => res.json({ success: true, data: await service.listActivePromotions() })),
  list: handle(async (req, res) => res.json({ success: true, data: await service.listPromotions({ status: req.query.status }) })),
  get: handle(async (req, res) => res.json({ success: true, data: await service.getPromotion(req.params.id) })),
  create: handle(async (req, res) => {
    const promo = await service.createPromotion(req.body, req.user.id)
    res.status(201).json({ success: true, data: promo, message: 'Promotion created' })
  }),
  update: handle(async (req, res) => {
    const promo = await service.updatePromotion(req.params.id, req.body, req.user.id)
    res.json({ success: true, data: promo, message: 'Promotion updated' })
  }),
}
