import api from './api'

export const salesService = {
  create: (data) => api.post('/sales', data),
  list: (params) => api.get('/sales', { params }),
  get: (id) => api.get(`/sales/${id}`),
  receipt: (id) => api.get(`/sales/${id}/receipt`),
  // data: { items?: [{ sale_item_id, quantity, restock }], reason }; no items refunds everything left
  refund: (id, data = {}) => api.post(`/sales/${id}/refund`, data),
  // data: { email? }; without one the receipt goes to the customer's email on file
  emailReceipt: (id, data = {}) => api.post(`/sales/${id}/email-receipt`, data),
  // data: { phone? }; without one the receipt goes to the customer's phone on file
  smsReceipt: (id, data = {}) => api.post(`/sales/${id}/sms-receipt`, data),
}
