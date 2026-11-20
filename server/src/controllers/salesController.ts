import type { PaymentMethod, PaymentStatus, Sale } from '@prisma/client'
import type { NextFunction, Request, Response } from 'express'
import * as salesService from '../services/salesService'
import type { RefundInput, SaleDetail, SaleInput } from '../services/salesService'
import * as gatewayRefundService from '../services/gatewayRefundService'
import { recordAudit } from '../utils/audit'
import { NotFoundError } from '../utils/errors'
import { currentUser } from '../middleware/auth'
import { actingBranchId } from '../middleware/branch'
import { queryInt, queryString } from '../utils/query'
import type { AuthUser } from '../types/express'

const without = <T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> =>
  // Every key but `keys` is copied, so the result is exactly Omit<T, K>
  Object.fromEntries(Object.entries(obj).filter(([key]) => !(keys as PropertyKey[]).includes(key))) as Omit<T, K>

const isOtherBranch = (sale: Pick<Sale, 'branch_id'>, user: AuthUser) => user.role !== 'ADMIN' && sale.branch_id !== user.branch_id

/** Another branch's sale with only what a return needs: no customer contacts or payment references. */
function forOtherBranch(sale: SaleDetail) {
  return {
    ...sale,
    customer: sale.customer && { id: sale.customer.id, name: sale.customer.name },
    payments: sale.payments.map((payment) => without(payment, ['reference'])),
    refunds: sale.refunds.map((refund) => ({
      ...without(refund, ['gateway_reference', 'gateway_refund_id', 'gateway_error']),
      has_gateway_reference: Boolean(refund.gateway_reference),
    })),
  }
}

function normalizeSale<S extends { sale_items?: unknown[]; payments?: unknown[] }>(sale: S) {
  return {
    ...sale,
    items: sale.sale_items ?? [],
    // The cash part first when there is one; split sales list every part in `payments`
    payment: sale.payments?.[0] ?? null,
    payments: sale.payments ?? [],
    sale_items: undefined,
  }
}

export async function createSale(req: Request, res: Response, next: NextFunction) {
  try {
    // Validated by the sales route
    const sale = await salesService.createSale(req.body as SaleInput, currentUser(req), actingBranchId(req))
    // Only null if a resent sale's client_ref clashed and the clashing sale then vanished
    if (!sale) throw new NotFoundError('Sale not found')
    res.status(201).json({ success: true, data: normalizeSale(sale), message: 'Sale processed successfully' })
  } catch (err) {
    next(err)
  }
}

export async function listSales(req: Request, res: Response, next: NextFunction) {
  try {
    const user = currentUser(req)
    const page = queryInt(req.query.page) || 1
    const per_page = queryInt(req.query.per_page) || 20
    const start_date = queryString(req.query.start_date)
    const end_date = queryString(req.query.end_date)
    const customer_id = queryString(req.query.customer_id)
    // The route only lets real statuses and methods through
    const payment_status = queryString(req.query.payment_status) as PaymentStatus | undefined
    const payment_method = queryString(req.query.payment_method) as PaymentMethod | undefined
    const search = queryString(req.query.search)

    // Cashiers can only see their own sales
    const user_id = user.role === 'CASHIER' ? user.id : queryString(req.query.user_id)

    const result = await salesService.listSales({
      page, per_page, start_date, end_date, user_id, customer_id, payment_status, payment_method, search,
      sort: queryString(req.query.sort), order: queryString(req.query.order), branchId: req.branchId,
    })
    const sales = result.sales.map(({ _count, ...s }) => ({ ...s, items_count: _count?.sale_items ?? 0 }))
    res.json({
      success: true,
      data: sales,
      meta: { page: result.page, per_page: result.per_page, total: result.total, total_pages: result.total_pages },
    })
  } catch (err) {
    next(err)
  }
}

export async function getSale(req: Request, res: Response, next: NextFunction) {
  try {
    const user = currentUser(req)
    const sale = await salesService.getSaleById(req.params.id)
    salesService.assertCanSeeSale(sale, user)
    res.json({ success: true, data: normalizeSale(isOtherBranch(sale, user) ? forOtherBranch(sale) : sale) })
  } catch (err) {
    next(err)
  }
}

/**
 * Any branch's sale, by its receipt number, so a return can be made at another branch. Only what a
 * return needs comes back: the customer's name but not their contact details, and no payment
 * references. Each lookup is recorded in the audit trail.
 */
export async function lookupSale(req: Request, res: Response, next: NextFunction) {
  try {
    const sale = await salesService.getSaleByTransactionId(req.params.transactionId, Number(req.query.total))
    await recordAudit({ userId: currentUser(req).id, action: 'SALE_LOOKUP', entity: 'Sale', entityId: sale.id, details: sale.transaction_id })
    res.json({ success: true, data: normalizeSale(forOtherBranch(sale)) })
  } catch (err) {
    next(err)
  }
}

export async function processRefund(req: Request, res: Response, next: NextFunction) {
  try {
    const user = currentUser(req)
    // Validated by the sales route
    const { items, reason } = (req.body as RefundInput | undefined) ?? {}
    const sale = await salesService.processRefund(req.params.id, user.id, { items, reason }, actingBranchId(req))
    // A return taken for another branch's sale gets the same trimmed sale as the lookup
    const data = isOtherBranch(sale, user) ? forOtherBranch(sale) : sale
    res.json({ success: true, data: normalizeSale(data), message: 'Refund processed successfully' })
  } catch (err) {
    next(err)
  }
}

export async function getReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    const user = currentUser(req)
    const receipt = await salesService.getReceiptData(req.params.id)
    salesService.assertCanSeeSale(receipt.sale, user, 'You can only view receipts for your own sales')
    const data = isOtherBranch(receipt.sale, user) ? { ...receipt, sale: forOtherBranch(receipt.sale) } : receipt
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export async function emailReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    const user = currentUser(req)
    const body = req.body as { email?: string } | undefined
    const sale = await salesService.getSaleById(req.params.id)
    salesService.assertCanSeeSale(sale, user, 'You can only email receipts for your own sales')
    const { to } = await salesService.emailReceipt(sale, user.id, body?.email)
    // Another branch's customer address stays hidden when it came from their record
    const shown = isOtherBranch(sale, user) && !body?.email ? null : to
    res.json({ success: true, data: { to: shown }, message: `Receipt sent to ${shown ?? "the customer's email"}` })
  } catch (err) {
    next(err)
  }
}

export async function smsReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    const user = currentUser(req)
    const body = req.body as { phone?: string } | undefined
    const sale = await salesService.getSaleById(req.params.id)
    salesService.assertCanSeeSale(sale, user, 'You can only text receipts for your own sales')
    const { to } = await salesService.smsReceipt(sale, user.id, body?.phone)
    const shown = isOtherBranch(sale, user) && !body?.phone ? null : to
    res.json({ success: true, data: { to: shown }, message: `Receipt texted to ${shown ?? "the customer's phone"}` })
  } catch (err) {
    next(err)
  }
}

export async function sendRefundToPaystack(req: Request, res: Response, next: NextFunction) {
  try {
    // Only staff who may see the sale, and for managers only refunds their own branch paid out
    const user = currentUser(req)
    const before = await salesService.getSaleById(req.params.id)
    salesService.assertCanSeeSale(before, user)
    const refund = before.refunds.find((r) => r.id === req.params.refundId)
    if (user.role === 'MANAGER' && refund && refund.branch_id !== user.branch_id) {
      throw new NotFoundError('Refund not found')
    }
    await gatewayRefundService.sendOrRefreshGatewayRefund(req.params.id, req.params.refundId, user.id)
    const sale = await salesService.getSaleById(req.params.id)
    const data = isOtherBranch(sale, user) ? forOtherBranch(sale) : sale
    res.json({ success: true, data: normalizeSale(data) })
  } catch (err) {
    next(err)
  }
}
