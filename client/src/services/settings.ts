import type { ApiSuccess, Settings } from '../types'
import api from './api'

export const settingsService = {
  get: () => api.get<ApiSuccess<Settings>>('/settings'),
  update: (data: Partial<Settings>) => api.put<ApiSuccess<Settings>>('/settings', data),
}
