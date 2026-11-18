import api from './api'

export const shiftsService = {
  current: () => api.get('/shifts/current'),
  open: (data) => api.post('/shifts/open', data),
  close: (id, data) => api.post(`/shifts/${id}/close`, data),
  get: (id) => api.get(`/shifts/${id}`),
  list: (params) => api.get('/shifts', { params }),
}
