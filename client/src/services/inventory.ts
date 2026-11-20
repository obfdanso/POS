import type { ApiPaginated, ApiSuccess, InventoryLog, Product, QueryParams } from '../types'
import api from './api'

/** What a restock or adjustment returns: the product with its new stock, and the log entry */
interface StockChangeResult {
  product: Product
  log: InventoryLog
}

export const inventoryService = {
  list: (params?: QueryParams) => api.get<ApiPaginated<Product>>('/inventory', { params }),
  lowStock: () => api.get<ApiSuccess<Product[]>>('/inventory/low-stock'),
  adjust: (data: { product_id: string; quantity_change: number; notes?: string }) =>
    api.post<ApiSuccess<StockChangeResult>>('/inventory/adjust', data),
  restock: (data: { product_id: string; quantity: number; notes?: string }) =>
    api.post<ApiSuccess<StockChangeResult>>('/inventory/restock', data),
  log: (productId: string, params?: QueryParams) => api.get<ApiPaginated<InventoryLog>>(`/inventory/log/${productId}`, { params }),
}
