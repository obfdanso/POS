import api from './api'

export const purchaseOrdersService = {
  list: (params) => api.get('/purchase-orders', { params }),
  get: (id) => api.get(`/purchase-orders/${id}`),
  // data: { supplier_id, items: [{ product_id, quantity, unit_cost }], expected_at?, notes? }
  create: (data) => api.post('/purchase-orders', data),
  // data: { items?: [{ item_id, quantity }], update_cost?, notes? }; no items receives everything outstanding
  receive: (id, data = {}) => api.post(`/purchase-orders/${id}/receive`, data),
  cancel: (id, data = {}) => api.post(`/purchase-orders/${id}/cancel`, data),
  suggestions: (supplierId) => api.get('/purchase-orders/suggestions', { params: { supplier_id: supplierId } }),
  suppliers: () => api.get('/suppliers', { params: { per_page: 100 } }),
}
