import api from './api'

export const promotionsService = {
  // Running promotions, for pricing the cart exactly as the server will
  active: () => api.get('/promotions/active'),
  list: (params) => api.get('/promotions', { params }),
  get: (id) => api.get(`/promotions/${id}`),
  // data: { name, percent_off, product_id?, category_id?, starts_at?, ends_at?, is_active? }
  create: (data) => api.post('/promotions', data),
  update: (id, data) => api.put(`/promotions/${id}`, data),
}
