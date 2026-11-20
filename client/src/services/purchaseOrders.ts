import type {
  ApiMessage,
  ApiPaginated,
  ApiSuccess,
  CreatePurchaseOrderPayload,
  PurchaseOrder,
  PurchaseOrderDetail,
  PurchaseSuggestion,
  QueryParams,
  ReceivePurchaseOrderPayload,
  Supplier,
} from '../types'
import api from './api'

export const purchaseOrdersService = {
  list: (params?: QueryParams) => api.get<ApiPaginated<PurchaseOrder>>('/purchase-orders', { params }),
  get: (id: string) => api.get<ApiSuccess<PurchaseOrderDetail>>(`/purchase-orders/${id}`),
  // data: { supplier_id, items: [{ product_id, quantity, unit_cost }], expected_at?, notes? }
  create: (data: CreatePurchaseOrderPayload) => api.post<ApiMessage<PurchaseOrderDetail>>('/purchase-orders', data),
  // data: { items?: [{ item_id, quantity }], update_cost?, notes? }; no items receives everything outstanding
  receive: (id: string, data: ReceivePurchaseOrderPayload = {}) => api.post<ApiMessage<PurchaseOrderDetail>>(`/purchase-orders/${id}/receive`, data),
  cancel: (id: string, data: { reason?: string } = {}) => api.post<ApiMessage<PurchaseOrderDetail>>(`/purchase-orders/${id}/cancel`, data),
  suggestions: (supplierId: string) =>
    api.get<ApiSuccess<PurchaseSuggestion[]>>('/purchase-orders/suggestions', { params: { supplier_id: supplierId } }),
  suppliers: () => api.get<ApiPaginated<Supplier>>('/suppliers', { params: { per_page: 100 } }),
}
