const shiftService = require('../services/shiftService')

async function getCurrentShift(req, res, next) {
  try {
    const shift = await shiftService.getCurrentShift(req.user.id)
    res.json({ success: true, data: shift })
  } catch (err) {
    next(err)
  }
}

async function openShift(req, res, next) {
  try {
    const shift = await shiftService.openShift(req.user.id, req.body)
    res.status(201).json({ success: true, data: shift, message: 'Shift opened' })
  } catch (err) {
    next(err)
  }
}

async function closeShift(req, res, next) {
  try {
    const shift = await shiftService.closeShift(req.params.id, req.user, req.body)
    res.json({ success: true, data: shift, message: 'Shift closed' })
  } catch (err) {
    next(err)
  }
}

async function getShift(req, res, next) {
  try {
    const shift = await shiftService.getShift(req.params.id, req.user)
    res.json({ success: true, data: shift })
  } catch (err) {
    next(err)
  }
}

async function listShifts(req, res, next) {
  try {
    const page = parseInt(req.query.page) || 1
    const per_page = parseInt(req.query.per_page) || 20
    const { status, start_date, end_date, sort, order } = req.query
    // Cashiers only see their own shifts
    const user_id = req.user.role === 'CASHIER' ? req.user.id : req.query.user_id

    const result = await shiftService.listShifts({ page, per_page, user_id, status, start_date, end_date, sort, order })
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

module.exports = { getCurrentShift, openShift, closeShift, getShift, listShifts }
