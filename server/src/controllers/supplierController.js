const supplierService = require('../services/supplierService')

async function listSuppliers(req, res, next) {
  try {
    const { page = 1, per_page = 50, search } = req.query
    const result = await supplierService.listSuppliers({
      page: parseInt(page),
      per_page: parseInt(per_page),
      search,
    })
    res.status(200).json({ success: true, ...result })
  } catch (err) {
    next(err)
  }
}

async function getSupplier(req, res, next) {
  try {
    const supplier = await supplierService.getSupplierById(req.params.id)
    res.status(200).json({ success: true, data: supplier })
  } catch (err) {
    next(err)
  }
}

async function createSupplier(req, res, next) {
  try {
    const { name, phone, email, address, website } = req.body
    const supplier = await supplierService.createSupplier({ name, phone, email, address, website })
    res.status(201).json({ success: true, data: supplier, message: 'Supplier created successfully' })
  } catch (err) {
    next(err)
  }
}

async function updateSupplier(req, res, next) {
  try {
    const { name, phone, email, address, website } = req.body
    const supplier = await supplierService.updateSupplier(req.params.id, { name, phone, email, address, website })
    res.status(200).json({ success: true, data: supplier, message: 'Supplier updated successfully' })
  } catch (err) {
    next(err)
  }
}

async function deleteSupplier(req, res, next) {
  try {
    await supplierService.deleteSupplier(req.params.id, req.user.id)
    res.status(200).json({ success: true, message: 'Supplier deleted successfully' })
  } catch (err) {
    next(err)
  }
}

module.exports = { listSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier }
