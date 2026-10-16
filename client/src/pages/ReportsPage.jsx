import { useState, useEffect, useCallback } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import toast from 'react-hot-toast'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Button } from '../components/Button'
import { Table } from '../components/Table'
import { reportsService } from '../services/reports'
import { formatCurrency } from '../utils/formatCurrency'
import { useSettings } from '../context/SettingsContext'
import { daysFromToday } from '../utils/date'

const PIE_COLORS = ['#2563EB', '#16A34A', '#D97706', '#DC2626', '#7C3AED', '#0891B2']

const TABS = [
  { id: 'summary', label: 'Sales Summary' },
  { id: 'daily', label: 'Daily Sales' },
  { id: 'top-products', label: 'Top Products' },
  { id: 'category', label: 'Category' },
  { id: 'cashier', label: 'Cashier Performance' },
  { id: 'profit', label: 'Profit' },
]

// Report tables sort in the browser: each report is a single, unpaginated result set
const money = (v) => <span className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(v ?? 0)}</span>

const topProductColumns = [
  { key: 'rank', label: '#', render: (_, row) => row.rank },
  { key: 'label', label: 'Product', sortable: true },
  { key: 'quantity', label: 'Qty Sold', sortable: true },
  { key: 'value', label: 'Revenue', sortable: true, render: money },
]

const categoryColumns = [
  { key: 'label', label: 'Category', sortable: true },
  { key: 'quantity', label: 'Units Sold', sortable: true },
  { key: 'value', label: 'Revenue', sortable: true, render: money },
]

const cashierColumns = [
  { key: 'label', label: 'Cashier', sortable: true },
  { key: 'transactions', label: 'Transactions', sortable: true },
  { key: 'value', label: 'Total Revenue', sortable: true, render: money },
]

const profitColumns = [
  { key: 'name', label: 'Product', sortable: true },
  { key: 'revenue', label: 'Revenue', sortable: true, render: money },
  { key: 'cost', label: 'Cost', sortable: true, render: money },
  {
    key: 'profit',
    label: 'Profit',
    sortable: true,
    render: (v) => (
      <span className={`font-semibold ${v >= 0 ? 'text-success-600' : 'text-danger-600'}`}>{formatCurrency(v ?? 0)}</span>
    ),
  },
  { key: 'margin', label: 'Margin %', sortable: true, render: (v) => (v != null ? `${v.toFixed(1)}%` : '—') },
]

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <svg className="animate-spin h-8 w-8 text-primary-600" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  )
}

function KpiCard({ label, value }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{value}</p>
    </div>
  )
}

function exportCsv(filename, headers, rows) {
  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  window.URL.revokeObjectURL(url)
}

export default function ReportsPage() {
  const { currency_symbol } = useSettings()
  const [activeTab, setActiveTab] = useState('summary')
  // Defaults to the last 30 days on every visit
  const [startDate, setStartDate] = useState(() => daysFromToday(-29))
  const [endDate, setEndDate] = useState(() => daysFromToday(0))
  const [loading, setLoading] = useState(false)

  const [summaryData, setSummaryData] = useState(null)
  const [dailyData, setDailyData] = useState([])
  const [topData, setTopData] = useState([])
  const [catData, setCatData] = useState([])
  const [cashierData, setCashierData] = useState([])
  const [profitData, setProfitData] = useState([])

  const fetchTab = useCallback(
    async (tab) => {
      if (!startDate || !endDate) return
      setLoading(true)
      const params = { start_date: startDate, end_date: endDate }
      try {
        if (tab === 'summary') {
          const res = await reportsService.salesSummary(params)
          setSummaryData(res.data?.data ?? res.data)
        } else if (tab === 'daily') {
          const res = await reportsService.salesByDay(params)
          setDailyData(res.data?.data ?? res.data ?? [])
        } else if (tab === 'top-products') {
          const res = await reportsService.topProducts({ ...params, limit: 50 })
          setTopData((res.data?.data ?? []).map((p, i) => ({ ...p, rank: i + 1 })))
        } else if (tab === 'category') {
          const res = await reportsService.categoryPerformance(params)
          setCatData(res.data?.data ?? res.data ?? [])
        } else if (tab === 'cashier') {
          const res = await reportsService.cashierPerformance(params)
          setCashierData(res.data?.data ?? res.data ?? [])
        } else if (tab === 'profit') {
          const res = await reportsService.profit(params)
          setProfitData(res.data?.data ?? res.data ?? [])
        }
      } catch {
        toast.error('Failed to load report data.')
      } finally {
        setLoading(false)
      }
    },
    [startDate, endDate]
  )

  useEffect(() => {
    fetchTab(activeTab)
  }, [activeTab, fetchTab])

  function handleTabChange(tab) {
    setActiveTab(tab)
  }

  function handleApply() {
    fetchTab(activeTab)
  }

  // Export helpers
  function exportSummary() {
    if (!summaryData) return
    exportCsv(
      'sales-summary.csv',
      ['Metric', 'Value'],
      [
        ['Total Revenue', summaryData.total_revenue ?? 0],
        ['Transaction Count', summaryData.transaction_count ?? 0],
        ['Average Sale', summaryData.average_sale ?? 0],
        ['Total Discount', summaryData.total_discount ?? 0],
        ['Total Tax', summaryData.total_tax ?? 0],
      ]
    )
  }
  function exportDaily() {
    exportCsv('daily-sales.csv', ['Date', 'Revenue'], dailyData.map((d) => [d.label, d.value ?? 0]))
  }
  function exportTopProducts() {
    exportCsv(
      'top-products.csv',
      ['Rank', 'Product', 'Quantity Sold', 'Revenue'],
      topData.map((p, i) => [i + 1, `"${p.name ?? p.label}"`, p.quantity_sold ?? p.quantity ?? 0, p.revenue ?? p.value ?? 0])
    )
  }
  function exportCategory() {
    exportCsv('category-performance.csv', ['Category', 'Revenue'], catData.map((c) => [`"${c.label}"`, c.value ?? 0]))
  }
  function exportCashier() {
    exportCsv(
      'cashier-performance.csv',
      ['Cashier', 'Transactions', 'Total Revenue'],
      cashierData.map((c) => [`"${c.label}"`, c.transactions ?? 0, c.value ?? 0])
    )
  }
  function exportProfit() {
    exportCsv(
      'profit.csv',
      ['Product', 'Revenue', 'Cost', 'Profit', 'Margin %'],
      profitData.map((p) => [
        `"${p.name ?? p.label}"`,
        p.revenue ?? 0,
        p.cost ?? 0,
        p.profit ?? 0,
        p.margin != null ? `${p.margin.toFixed(1)}%` : '—',
      ])
    )
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Reports</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Business analytics and performance insights</p>
        </div>

        {/* Date range */}
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-4 shadow-sm flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Start Date</label>
            <input
              type="date"
              value={startDate}
              max={endDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">End Date</label>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
          </div>
          <Button onClick={handleApply} isLoading={loading}>
            Apply
          </Button>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 dark:border-gray-800">
          <nav className="-mb-px flex gap-1 overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        <div>
          {/* Sales Summary */}
          {activeTab === 'summary' && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button variant="secondary" size="sm" onClick={exportSummary}>
                  Export CSV
                </Button>
              </div>
              {loading ? (
                <Spinner />
              ) : !summaryData ? (
                <p className="text-center text-gray-400 py-10">No data available</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
                  <KpiCard label="Total Revenue" value={formatCurrency(summaryData.total_revenue ?? 0)} />
                  <KpiCard label="Transactions" value={summaryData.transaction_count ?? 0} />
                  <KpiCard label="Average Sale" value={formatCurrency(summaryData.average_sale ?? 0)} />
                  <KpiCard label="Total Discount" value={formatCurrency(summaryData.total_discount ?? 0)} />
                  <KpiCard label="Total Tax" value={formatCurrency(summaryData.total_tax ?? 0)} />
                </div>
              )}
            </div>
          )}

          {/* Daily Sales */}
          {activeTab === 'daily' && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button variant="secondary" size="sm" onClick={exportDaily}>
                  Export CSV
                </Button>
              </div>
              {loading ? (
                <Spinner />
              ) : dailyData.length === 0 ? (
                <p className="text-center text-gray-400 py-10">No data available</p>
              ) : (
                <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-6 shadow-sm">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Daily Revenue</h2>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={dailyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} />
                      <YAxis tickFormatter={(v) => `${currency_symbol || 'GH₵'}${v}`} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={72} />
                      <Tooltip formatter={(v) => [formatCurrency(v), 'Revenue']} />
                      <Bar dataKey="value" fill="#2563EB" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* Top Products */}
          {activeTab === 'top-products' && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button variant="secondary" size="sm" onClick={exportTopProducts}>
                  Export CSV
                </Button>
              </div>
              {loading ? (
                <Spinner />
              ) : topData.length === 0 ? (
                <p className="text-center text-gray-400 py-10">No data available</p>
              ) : (
                <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl shadow-sm overflow-hidden">
                  <Table columns={topProductColumns} data={topData} />
                </div>
              )}
            </div>
          )}

          {/* Category */}
          {activeTab === 'category' && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button variant="secondary" size="sm" onClick={exportCategory}>
                  Export CSV
                </Button>
              </div>
              {loading ? (
                <Spinner />
              ) : catData.length === 0 ? (
                <p className="text-center text-gray-400 py-10">No data available</p>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl shadow-sm overflow-hidden">
                    <Table columns={categoryColumns} data={catData} />
                  </div>
                  <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl shadow-sm p-6">
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie data={catData} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={100}>
                          {catData.map((_, index) => (
                            <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v) => formatCurrency(v)} />
                        <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Cashier Performance */}
          {activeTab === 'cashier' && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button variant="secondary" size="sm" onClick={exportCashier}>
                  Export CSV
                </Button>
              </div>
              {loading ? (
                <Spinner />
              ) : cashierData.length === 0 ? (
                <p className="text-center text-gray-400 py-10">No data available</p>
              ) : (
                <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl shadow-sm overflow-hidden">
                  <Table columns={cashierColumns} data={cashierData} />
                </div>
              )}
            </div>
          )}

          {/* Profit */}
          {activeTab === 'profit' && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button variant="secondary" size="sm" onClick={exportProfit}>
                  Export CSV
                </Button>
              </div>
              {loading ? (
                <Spinner />
              ) : profitData.length === 0 ? (
                <p className="text-center text-gray-400 py-10">No data available</p>
              ) : (
                <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl shadow-sm overflow-hidden">
                  <Table columns={profitColumns} data={profitData} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
