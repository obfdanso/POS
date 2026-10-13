import { useState, useEffect } from 'react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import toast from 'react-hot-toast'
import api from '../services/api'
import { formatCurrency } from '../utils/formatCurrency'

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })
}

const methodBadge = {
  CASH: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  MOBILE_MONEY: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  CARD: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
}

function StatCard({ label, value, sub, icon }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 flex items-start gap-4 shadow-sm">
      <div className="w-12 h-12 rounded-full bg-teal-50 dark:bg-teal-900/30 flex items-center justify-center text-teal-600 dark:text-teal-400 flex-shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
        {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

export default function CashierDashboardPage() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  // Sales made during this browser session only
  const [sessionSales] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem('pos_session_sales') || '[]')
    } catch {
      return [] // sessionStorage unavailable
    }
  })

  useEffect(() => {
    api.get('/reports/cashier-stats')
      .then((res) => setStats(res.data.data))
      .catch(() => toast.error("Failed to load today's stats"))
      .finally(() => setLoading(false))
  }, [])

  const today = new Date().toLocaleDateString('en-GH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Welcome back
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{today}</p>
        </div>

        {/* Stat Cards */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 animate-pulse h-28" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard
              label="Sales Today"
              value={stats?.sales_count ?? 0}
              sub="completed transactions"
              icon={
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
              }
            />
            <StatCard
              label="Revenue Today"
              value={formatCurrency(stats?.total_revenue)}
              sub="total processed today"
              icon={
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
            <StatCard
              label="Items Sold"
              value={stats?.items_sold ?? 0}
              sub="units across all sales"
              icon={
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              }
            />
            <StatCard
              label="Average Sale"
              value={formatCurrency(stats?.average_sale)}
              sub="per transaction today"
              icon={
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              }
            />
          </div>
        )}

        {/* Recent Sales — session only */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Recent Sales</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Sales made in this session</p>
          </div>

          {sessionSales.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <svg className="w-10 h-10 text-gray-200 dark:text-gray-700 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.5 6h13M7 13H5.4" />
              </svg>
              <p className="text-sm text-gray-400 dark:text-gray-500">No sales yet this session</p>
              <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">Completed transactions will appear here</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {sessionSales.map((sale) => (
                <div key={sale.id} className="px-6 py-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-teal-50 dark:bg-teal-900/20 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-teal-600 dark:text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{sale.transaction_id}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {formatTime(sale.created_at)} · {sale.customer_name || 'Walk-in'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${methodBadge[sale.payment_method] || ''}`}>
                      {sale.payment_method.replace('_', ' ')}
                    </span>
                    <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{formatCurrency(sale.total_amount)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
