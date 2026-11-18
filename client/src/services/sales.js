import api from './api'

export const salesService = {
  create: (data) => api.post('/sales', data),
  list: (params) => api.get('/sales', { params }),
  get: (id) => api.get(`/sales/${id}`),
  receipt: (id) => api.get(`/sales/${id}/receipt`),
  // data: { items?: [{ sale_item_id, quantity, restock }], reason }; no items refunds everything left
  refund: (id, data = {}) => api.post(`/sales/${id}/refund`, data),
}
