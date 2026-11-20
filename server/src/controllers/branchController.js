const branchService = require('../services/branchService')

async function listBranches(req, res, next) {
  try {
    // Only admins see closed branches and the full details
    const active = req.query.active === 'true' || req.user.role !== 'ADMIN'
    const branches = await branchService.listBranches({ active })
    res.status(200).json({ success: true, data: branches })
  } catch (err) {
    next(err)
  }
}

async function getBranch(req, res, next) {
  try {
    res.status(200).json({ success: true, data: await branchService.getBranch(req.params.id) })
  } catch (err) {
    next(err)
  }
}

async function createBranch(req, res, next) {
  try {
    const { name, code, address, phone } = req.body
    const branch = await branchService.createBranch({ name, code, address, phone }, req.user.id)
    res.status(201).json({ success: true, data: branch, message: 'Branch created successfully' })
  } catch (err) {
    next(err)
  }
}

async function updateBranch(req, res, next) {
  try {
    const { name, code, address, phone, is_active } = req.body
    const branch = await branchService.updateBranch(req.params.id, { name, code, address, phone, is_active }, req.user.id)
    res.status(200).json({ success: true, data: branch, message: 'Branch updated successfully' })
  } catch (err) {
    next(err)
  }
}

module.exports = { listBranches, getBranch, createBranch, updateBranch }
