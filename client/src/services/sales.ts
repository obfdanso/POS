import type { ApiPaginated, ApiSuccess, CreateSalePayload, QueryParams, ReceiptData, RefundPayload, Sale } from '../types'
import api from './api'

export const salesService = {
  // branchId: send to a particular branch (a sale queued offline goes to the branch it was rung up at)
  create: (data: CreateSalePayload, branchId?: string | null) =>
    api.post<ApiSuccess<Sale>>('/sales', data, branchId ? { headers: { 'X-Branch-Id': branchId } } : undefined),
  // Any branch's sale by its receipt number and total, for returns made at another branch
  lookup: (transactionId: string, total: string | number) =>
    api.get<ApiSuccess<Sale>>(`/sales/lookup/${encodeURIComponent(transactionId)}`, { params: { total } }),
  list: (params?: QueryParams) => api.get<ApiPaginated<Sale>>('/sales', { params }),
  get: (id: string) => api.get<ApiSuccess<Sale>>(`/sales/${id}`),
  receipt: (id: string) => api.get<ApiSuccess<ReceiptData>>(`/sales/${id}/receipt`),
  // data: { items?: [{ sale_item_id, quantity, restock }], reason }; no items refunds everything left
  refund: (id: string, data: RefundPayload = {}) => api.post<ApiSuccess<Sale>>(`/sales/${id}/refund`, data),
  // data: { email? }; without one the receipt goes to the customer's email on file
  emailReceipt: (id: string, data: { email?: string } = {}) => api.post<ApiSuccess<{ to: string | null }>>(`/sales/${id}/email-receipt`, data),
  // data: { phone? }; without one the receipt goes to the customer's phone on file
  smsReceipt: (id: string, data: { phone?: string } = {}) => api.post<ApiSuccess<{ to: string | null }>>(`/sales/${id}/sms-receipt`, data),
  // Sends a refund's card / Mobile Money part through Paystack, or checks on one already sent
  sendRefundToPaystack: (id: string, refundId: string) => api.post<ApiSuccess<Sale>>(`/sales/${id}/refunds/${refundId}/paystack`, {}),
}
