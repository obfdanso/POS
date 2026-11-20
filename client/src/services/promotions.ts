import type { ActivePromotion, ApiSuccess, Promotion, PromotionPayload, QueryParams } from '../types'
import api from './api'

export const promotionsService = {
  // Running promotions, for pricing the cart exactly as the server will
  active: () => api.get<ApiSuccess<ActivePromotion[]>>('/promotions/active'),
  list: (params?: QueryParams) => api.get<ApiSuccess<Promotion[]>>('/promotions', { params }),
  get: (id: string) => api.get<ApiSuccess<Promotion>>(`/promotions/${id}`),
  // data: { name, percent_off, product_id?, category_id?, starts_at?, ends_at?, is_active? }
  create: (data: PromotionPayload) => api.post<ApiSuccess<Promotion>>('/promotions', data),
  update: (id: string, data: Partial<PromotionPayload>) => api.put<ApiSuccess<Promotion>>(`/promotions/${id}`, data),
}
