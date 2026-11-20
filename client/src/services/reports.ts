import type {
  ApiSuccess,
  BranchPerformanceRow,
  CashierPerformanceRow,
  CategoryPerformanceRow,
  DashboardReport,
  InventoryStatusReport,
  ProfitRow,
  QueryParams,
  SalesByDayRow,
  SalesSummaryReport,
  TopProductRow,
} from '../types'
import api from './api'

export const reportsService = {
  dashboard: () => api.get<ApiSuccess<DashboardReport>>('/reports/dashboard'),
  salesSummary: (params?: QueryParams) => api.get<ApiSuccess<SalesSummaryReport>>('/reports/sales-summary', { params }),
  salesByDay: (params?: QueryParams) => api.get<ApiSuccess<SalesByDayRow[]>>('/reports/sales-by-day', { params }),
  topProducts: (params?: QueryParams) => api.get<ApiSuccess<TopProductRow[]>>('/reports/top-products', { params }),
  categoryPerformance: (params?: QueryParams) => api.get<ApiSuccess<CategoryPerformanceRow[]>>('/reports/category-performance', { params }),
  cashierPerformance: (params?: QueryParams) => api.get<ApiSuccess<CashierPerformanceRow[]>>('/reports/cashier-performance', { params }),
  inventoryStatus: () => api.get<ApiSuccess<InventoryStatusReport>>('/reports/inventory-status'),
  profit: (params?: QueryParams) => api.get<ApiSuccess<ProfitRow[]>>('/reports/profit', { params }),
  // Every branch side by side (admins viewing all branches)
  branchPerformance: (params?: QueryParams) => api.get<ApiSuccess<BranchPerformanceRow[]>>('/reports/branch-performance', { params }),
}
