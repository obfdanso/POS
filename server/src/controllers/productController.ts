import type { NextFunction, Request, Response } from 'express'
import * as productService from '../services/productService'
import type { CategoryInput, NewProductInput, ProductInput } from '../services/productService'
import { currentUser } from '../middleware/auth'
import { queryInt, queryString } from '../utils/query'

export async function listProducts(req: Request, res: Response, next: NextFunction) {
  try {
    const page = queryInt(req.query.page) || 1
    const per_page = queryInt(req.query.per_page) || 20
    const search = queryString(req.query.search)
    const category_id = queryString(req.query.category_id)
    // Inactive products are only listed for staff who manage the catalogue
    const canSeeInactive = ['ADMIN', 'MANAGER'].includes(currentUser(req).role)
    const status = canSeeInactive ? queryString(req.query.status) : 'active'

    const group_variants = req.query.group_variants === 'true'
    const include_unstocked = canSeeInactive && req.query.include_unstocked === 'true'
    const result = await productService.listProducts({
      page, per_page, search, category_id, status, group_variants, include_unstocked,
      sort: queryString(req.query.sort), order: queryString(req.query.order), branchId: req.branchId,
    })

    res.json({
      success: true,
      data: result.products,
      meta: {
        page: result.page,
        per_page: result.per_page,
        total: result.total,
        total_pages: result.total_pages,
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function getProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const product = await productService.getProductById(req.params.id, req.branchId, { allBranches: currentUser(req).role === 'ADMIN' })
    res.json({ success: true, data: product })
  } catch (err) {
    next(err)
  }
}

export async function getProductByBarcode(req: Request, res: Response, next: NextFunction) {
  try {
    const product = await productService.getProductByBarcode(req.params.code, req.branchId)
    res.json({ success: true, data: product })
  } catch (err) {
    next(err)
  }
}

export async function createProduct(req: Request, res: Response, next: NextFunction) {
  try {
    // Validated by the products route
    const data = { ...(req.body as NewProductInput) }
    delete data.image_url
    if (req.file) {
      data.image_url = `/uploads/products/${req.file.filename}`
    }
    const product = await productService.createProduct(data, currentUser(req), req.branchId)
    res.status(201).json({ success: true, data: product, message: 'Product created successfully' })
  } catch (err) {
    next(err)
  }
}

export async function updateProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const data = { ...(req.body as ProductInput) }
    if (req.file) {
      data.image_url = `/uploads/products/${req.file.filename}`
    } else if (data.image_url) {
      // Clients may only clear the image (image_url: null); new images must be uploaded
      delete data.image_url
    }
    const product = await productService.updateProduct(req.params.id, data, currentUser(req), req.branchId)
    res.json({ success: true, data: product, message: 'Product updated successfully' })
  } catch (err) {
    next(err)
  }
}

export async function deleteProduct(req: Request, res: Response, next: NextFunction) {
  try {
    await productService.softDeleteProduct(req.params.id, currentUser(req).id)
    res.json({ success: true, data: null, message: 'Product deactivated successfully' })
  } catch (err) {
    next(err)
  }
}

export async function listCategories(req: Request, res: Response, next: NextFunction) {
  try {
    const categories = await productService.listCategories()
    res.json({ success: true, data: categories })
  } catch (err) {
    next(err)
  }
}

export async function createCategory(req: Request, res: Response, next: NextFunction) {
  try {
    // Validated by the categories route
    const category = await productService.createCategory(req.body as CategoryInput & { name: string })
    res.status(201).json({ success: true, data: category, message: 'Category created successfully' })
  } catch (err) {
    next(err)
  }
}

export async function updateCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const category = await productService.updateCategory(req.params.id, req.body as CategoryInput)
    res.json({ success: true, data: category, message: 'Category updated successfully' })
  } catch (err) {
    next(err)
  }
}
