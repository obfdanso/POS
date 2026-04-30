import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { reportsService } from '../services/reports'
import { formatCurrency } from '../utils/formatCurrency'

const PIE_COLORS = ['#0d9488', '#16A34A', '#D97706', '#DC2626', '#7C3AED', '#0891B2']

function SkeletonCard() {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-100 dark:border-gray-800 shadow-sm animate-pulse">
      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-3" />
      <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2" />
      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
    </div>
  )
}

function KpiCard({ title, value, subtitle, icon, color }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-100 dark:border-gray-800 shadow-sm flex items-start gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">{title}</p>
        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-0.5 truncate">{value}</p>
        {subtitle && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{subtitle}</p>}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const today = new Date().toISOString().split('T')[0]

  const [summary, setSummary] = useState(null)
  const [dailySales, setDailySales] = useState([])
  const [topProducts, setTopProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [inventoryStatus, setInventoryStatus] = useState(null)

  const [loadingSummary, setLoadingSummary] = useState(true)
  const [loadingCharts, setLoadingCharts] = useState(true)
  const [loadingInventory, setLoadingInventory] = useState(true)
  const [error, setError] = useState(null)

  // Compute date ranges
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0]

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29)
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0]

  useEffect(() => {
    async function fetchSummary() {
      try {
        const res = await reportsService.salesSummary({ start_date: thirtyDaysAgoStr, end_date: today })
        setSummary(res.data?.data ?? res.data)
      } catch (e) {
        setError('Failed to load summary data.')
      } finally {
        setLoadingSummary(false)
      }
    }
    fetchSummary()
  }, [today, thirtyDaysAgoStr])

  useEffect(() => {
    async function fetchCharts() {
      try {
        const [dailyRes, topRes, catRes] = await Promise.all([
          reportsService.salesByDay({ start_date: sevenDaysAgoStr, end_date: today }),
          reportsService.topProducts({ limit: 5, start_date: sevenDaysAgoStr, end_date: today }),
          reportsService.categoryPerformance({ start_date: sevenDaysAgoStr, end_date: today }),
        ])
        setDailySales(dailyRes.data?.data ?? dailyRes.data ?? [])
        setTopProducts(topRes.data?.data ?? topRes.data ?? [])
        setCategories(catRes.data?.data ?? catRes.data ?? [])
      } catch (e) {
        // non-fatal
      } finally {
        setLoadingCharts(false)
      }
    }
    fetchCharts()
  }, [sevenDaysAgoStr, today])

  useEffect(() => {
    async function fetchInventory() {
      try {
        const res = await reportsService.inventoryStatus()
        setInventoryStatus(res.data?.data ?? res.data)
      } catch (e) {
        // non-fatal
      } finally {
        setLoadingInventory(false)
      }
    }
    fetchInventory()
  }, [])

  const lowStockItems = inventoryStatus?.low_stock ?? []

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Welcome banner */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              Welcome back
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {new Date().toLocaleDateString('en-GH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              {' '}— here&apos;s how your store is performing today
            </p>
          </div>
          <Link
            to="/pos"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-full transition self-start sm:self-center flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            New Sale
          </Link>
        </div>

        {error && (
          <div className="bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-800 text-danger-700 dark:text-danger-400 rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* KPI cards — 2×2 grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {loadingSummary ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          ) : (
            <>
              <KpiCard
                title="Total Revenue (30 Days)"
                value={formatCurrency(summary?.total_revenue ?? 0)}
                subtitle="Last 30 days, completed sales"
                color="bg-primary-100 dark:bg-primary-900/30"
                icon={
                  <svg className="w-6 h-6 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
              <KpiCard
                title="Transactions (30 Days)"
                value={summary?.transaction_count ?? 0}
                subtitle="Last 30 days, completed sales"
                color="bg-success-100 dark:bg-success-900/30"
                icon={
                  <svg className="w-6 h-6 text-success-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                }
              />
              <KpiCard
                title="Low Stock Items"
                value={loadingInventory ? '...' : lowStockItems.length}
                subtitle="Below threshold"
                color="bg-warning-100 dark:bg-warning-900/30"
                icon={
                  <svg className="w-6 h-6 text-warning-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                }
              />
              <KpiCard
                title="Total Products"
                value={inventoryStatus?.total_products ?? (loadingInventory ? '...' : 0)}
                subtitle="Active in catalog"
                color="bg-purple-100 dark:bg-purple-900/30"
                icon={
                  <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                }
              />
            </>
          )}
        </div>

        {/* Revenue line chart — full width */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Revenue — Last 7 Days</h2>
          {loadingCharts ? (
            <div className="h-56 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
          ) : dailySales.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-gray-400 dark:text-gray-600 text-sm">No data available</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={dailySales} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} />
                <YAxis tickFormatter={(v) => `GH₵${v}`} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={70} />
                <Tooltip formatter={(v) => [formatCurrency(v), 'Revenue']} />
                <Line type="monotone" dataKey="value" stroke="#0d9488" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Secondary widgets — two-column grid */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Top 5 products */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Top 5 Products (Last 7 Days)</h2>
            {loadingCharts ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-8 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                ))}
              </div>
            ) : topProducts.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-600 py-6 text-center">No sales data</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800">
                    <th className="pb-2 w-8">#</th>
                    <th className="pb-2">Product</th>
                    <th className="pb-2 text-right">Qty</th>
                    <th className="pb-2 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {topProducts.map((p, i) => (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="py-2.5 text-gray-400 dark:text-gray-600 font-medium">{i + 1}</td>
                      <td className="py-2.5 text-gray-900 dark:text-gray-100 font-medium truncate max-w-[160px]">{p.name || p.label}</td>
                      <td className="py-2.5 text-right text-gray-600 dark:text-gray-400">{p.quantity_sold ?? p.quantity ?? '—'}</td>
                      <td className="py-2.5 text-right font-semibold text-gray-900 dark:text-gray-100">{formatCurrency(p.revenue ?? p.value ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Sales by Category pie chart */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Sales by Category</h2>
            {loadingCharts ? (
              <div className="h-56 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
            ) : categories.length === 0 ? (
              <div className="h-56 flex items-center justify-center text-gray-400 dark:text-gray-600 text-sm">No data available</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={categories}
                    dataKey="value"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    outerRadius={75}
                    labelLine={false}
                  >
                    {categories.map((_, index) => (
                      <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => formatCurrency(v)} />
                  <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Low stock alerts — full width */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Low Stock Alerts</h2>
            <Link to="/inventory" className="text-xs text-primary-600 hover:text-primary-700 font-medium">
              View all →
            </Link>
          </div>
          {loadingInventory ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-12 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
              ))}
            </div>
          ) : lowStockItems.length === 0 ? (
            <div className="py-8 text-center">
              <svg className="w-10 h-10 text-success-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-gray-400 dark:text-gray-600">All products are well stocked</p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {lowStockItems.slice(0, 9).map((item, i) => (
                <li key={item.id ?? i} className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{item.name}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">SKU: {item.sku}</p>
                  </div>
                  <span className={`ml-3 text-xs font-bold px-2 py-1 rounded-full flex-shrink-0 ${
                    item.quantity === 0
                      ? 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400'
                      : 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400'
                  }`}>
                    {item.quantity === 0 ? 'Out of stock' : `${item.quantity} left`}
                  </span>
                </li>
              ))}
              {lowStockItems.length > 9 && (
                <li className="flex items-center px-3 py-2.5">
                  <Link to="/inventory" className="text-xs text-primary-600 hover:underline">
                    +{lowStockItems.length - 9} more items →
                  </Link>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
