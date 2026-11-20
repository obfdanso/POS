import type { ApiSuccess, JsonBody, QueryParams, User } from '../types'
import api from './api'

export const usersService = {
  list: (params?: QueryParams) => api.get<ApiSuccess<User[]>>('/users', { params }),
  staff: () => api.get<ApiSuccess<Pick<User, 'id' | 'full_name' | 'role'>[]>>('/users/staff'),
  get: (id: string) => api.get<ApiSuccess<User>>(`/users/${id}`),
  create: (data: JsonBody) => api.post<ApiSuccess<User>>('/users', data),
  update: (id: string, data: JsonBody) => api.put<ApiSuccess<User>>(`/users/${id}`, data),
  resetPassword: (id: string, data: { password: string }) => api.post<ApiSuccess<undefined>>(`/users/${id}/reset-password`, data),
  unlock: (id: string) => api.post<ApiSuccess<undefined>>(`/users/${id}/unlock`),
}
