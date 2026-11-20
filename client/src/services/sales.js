import api from './api'

export const salesService = {
  // branchId: send to a particular branch (a sale queued offline goes to the branch it was rung up at)
  create: (data, branchId) => api.post('/sales', data, branchId ? { headers: { 'X-Branch-Id': branchId } } : undefined),
  // Any branch's sale by its receipt number, for returns made at another branch
  lookup: (transactionId) => api.get(`/sales/lookup/${encodeURIComponent(transactionId)}`),
  list: (params) => api.get('/sales', { params }),
  get: (id) => api.get(`/sales/${id}`),
  receipt: (id) => api.get(`/sales/${id}/receipt`),
  // data: { items?: [{ sale_item_id, quantity, restock }], reason }; no items refunds everything left
  refund: (id, data = {}) => api.post(`/sales/${id}/refund`, data),
  // data: { email? }; without one the receipt goes to the customer's email on file
  emailReceipt: (id, data = {}) => api.post(`/sales/${id}/email-receipt`, data),
  // data: { phone? }; without one the receipt goes to the customer's phone on file
  smsReceipt: (id, data = {}) => api.post(`/sales/${id}/sms-receipt`, data),
  // Sends a refund's card / Mobile Money part through Paystack, or checks on one already sent
  sendRefundToPaystack: (id, refundId) => api.post(`/sales/${id}/refunds/${refundId}/paystack`, {}),
}
