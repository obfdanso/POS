import type { ApiMessage, ApiSuccess, Branch, BranchRef, JsonBody, QueryParams } from '../types'
import api from './api'

export const branchesService = {
  // `?active=true` (and every non-admin) gets [{ id, name, code }]; admins otherwise get full rows
  list: (params?: QueryParams) => api.get<ApiSuccess<(Branch | BranchRef)[]>>('/branches', { params }),
  get: (id: string) => api.get<ApiSuccess<Branch>>(`/branches/${id}`),
  create: (data: JsonBody) => api.post<ApiMessage<Branch>>('/branches', data),
  update: (id: string, data: JsonBody) => api.put<ApiMessage<Branch>>(`/branches/${id}`, data),
}
