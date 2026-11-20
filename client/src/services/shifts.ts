import type { ApiPaginated, ApiSuccess, QueryParams, Shift } from '../types'
import api from './api'

export const shiftsService = {
  current: () => api.get<ApiSuccess<Shift | null>>('/shifts/current'),
  open: (data: { opening_float: number; notes?: string }) => api.post<ApiSuccess<Shift>>('/shifts/open', data),
  close: (id: string, data: { counted_cash: number; notes?: string }) => api.post<ApiSuccess<Shift>>(`/shifts/${id}/close`, data),
  get: (id: string) => api.get<ApiSuccess<Shift>>(`/shifts/${id}`),
  list: (params?: QueryParams) => api.get<ApiPaginated<Shift>>('/shifts', { params }),
}
