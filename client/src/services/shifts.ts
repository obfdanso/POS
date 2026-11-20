import type { ApiPaginated, ApiSuccess, QueryParams, Shift, ShiftWithSummary } from '../types'
import api from './api'

export const shiftsService = {
  current: () => api.get<ApiSuccess<ShiftWithSummary | null>>('/shifts/current'),
  open: (data: { opening_float: number; notes?: string }) => api.post<ApiSuccess<ShiftWithSummary>>('/shifts/open', data),
  close: (id: string, data: { counted_cash: number; notes?: string }) => api.post<ApiSuccess<ShiftWithSummary>>(`/shifts/${id}/close`, data),
  get: (id: string) => api.get<ApiSuccess<ShiftWithSummary>>(`/shifts/${id}`),
  list: (params?: QueryParams) => api.get<ApiPaginated<Shift>>('/shifts', { params }),
}
