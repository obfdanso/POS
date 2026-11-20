import type { ApiPaginated, ApiSuccess, Category, JsonBody, Product, ProductBody, QueryParams } from '../types'
import api from './api'

export const productsService = {
  list: (params?: QueryParams) => api.get<ApiPaginated<Product>>('/products', { params }),
  get: (id: string) => api.get<ApiSuccess<Product>>(`/products/${id}`),
  create: (data: ProductBody) => api.post<ApiSuccess<Product>>('/products', data),
  update: (id: string, data: ProductBody) => api.put<ApiSuccess<Product>>(`/products/${id}`, data),
  delete: (id: string) => api.delete<ApiSuccess<Product>>(`/products/${id}`),
  byBarcode: (code: string) => api.get<ApiSuccess<Product>>(`/products/barcode/${code}`),
  categories: () => api.get<ApiSuccess<Category[]>>('/categories'),
  createCategory: (data: JsonBody) => api.post<ApiSuccess<Category>>('/categories', data),
}
