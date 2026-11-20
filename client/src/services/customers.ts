import type { ApiPaginated, ApiSuccess, Customer, JsonBody, QueryParams, Sale } from '../types'
import api from './api'

export const customersService = {
  list: (params?: QueryParams) => api.get<ApiPaginated<Customer>>('/customers', { params }),
  get: (id: string) => api.get<ApiSuccess<Customer>>(`/customers/${id}`),
  create: (data: JsonBody) => api.post<ApiSuccess<Customer>>('/customers', data),
  update: (id: string, data: JsonBody) => api.put<ApiSuccess<Customer>>(`/customers/${id}`, data),
  purchases: (id: string, params?: QueryParams) => api.get<ApiPaginated<Sale>>(`/customers/${id}/purchases`, { params }),
}
