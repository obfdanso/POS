import { useState, useEffect, useCallback } from 'react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Modal } from '../components/Modal'
import api from '../services/api'
import { formatCurrency } from '../utils/formatCurrency'
import { toISODate } from '../utils/date'

function formatDateTime(dateStr) {
  return new Date(dateStr).toLocaleString('en-GH', { hour: '2-digit', minute: '2-digit' })
}

const methodBadge = {
  CASH: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  MOBILE_MONEY: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  CARD: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
}

const DATE_FILTERS = [
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'week' },
  { label: 'This Month', value: 'month' },
]

function getDateRange(filter) {
  const now = new Date()
  const end = toISODate(now)
  if (filter === 'today') {
    return { start_date: end, end_date: end }
  }
  if (filter === 'week') {
    const start = new Date(now)
    start.setDate(now.getDate() - now.getDay())
    return { start_date: toISODate(start), end_date: end }
  }
  // month
  return { start_date: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), end_date: end }
}

export default function CashierSalesPage() {
  const [dateFilter, setDateFilter] = useState('today')
  const [sales, setSales] = useState([])
  const [meta, setMeta] = useState({ page: 1, total_pages: 1, total: 0 })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [selectedSale, setSelectedSale] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const fetchSales = useCallback(async () => {
    setLoading(true)
    try {
      const { start_date, end_date } = getDateRange(dateFilter)
      const res = await api.get('/sales', { params: { start_date, end_date, page, per_page: 15 } })
      setSales(res.data.data || [])
      setMeta(res.data.meta || { page: 1, total_pages: 1, total: 0 })
    } catch {
      setSales([])
    } finally {
      setLoading(false)
    }
  }, [dateFilter, page])

  useEffect(() => {
    setPage(1)
  }, [dateFilter])

  useEffect(() => {
    fetchSales()
  }, [fetchSales])

  async function openSaleDetail(sale) {
    setDetailLoading(true)
    setSelectedSale({ ...sale, _loading: true })
    try {
      const res = await api.get(`/sales/${sale.id}`)
      const data = res.data.data
      setSelectedSale({
        ...data,
        items: data.items ?? [],
        payment: data.payment ?? null,
      })
    } catch {
      setSelectedSale(null)
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">My Sales</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Your personal sales history</p>
          </div>

          {/* Date filter toggle */}
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-full">
            {DATE_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setDateFilter(f.value)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
                  dateFilter === f.value
                    ? 'bg-white dark:bg-gray-700 text-teal-700 dark:text-teal-400 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Time</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Transaction ID</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Customer</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Items</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Total</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Payment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {loading ? (
                  [...Array(8)].map((_, i) => (
                    <tr key={i}>
                      {[...Array(6)].map((__, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : sales.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-400 dark:text-gray-500">
                      No sales found for this period.
                    </td>
                  </tr>
                ) : (
                  sales.map((sale) => (
                    <tr
                      key={sale.id}
                      onClick={() => openSaleDetail(sale)}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition"
                    >
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {formatDateTime(sale.created_at)}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">
                        {sale.transaction_id}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                        {sale.customer?.name || <span className="text-gray-400 dark:text-gray-500 italic">Walk-in</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">
                        {sale.items_count ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">
                        {formatCurrency(sale.total_amount)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${methodBadge[sale.payment_method] || ''}`}>
                          {sale.payment_method?.replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {meta.total_pages > 1 && (
            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
              <span>{meta.total} total</span>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                >
                  Prev
                </button>
                <span className="px-3 py-1.5">{page} / {meta.total_pages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(meta.total_pages, p + 1))}
                  disabled={page === meta.total_pages}
                  className="px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sale Detail Modal */}
      <Modal
        isOpen={!!selectedSale}
        onClose={() => setSelectedSale(null)}
        title={selectedSale?.transaction_id || 'Sale Details'}
        size="md"
      >
        {detailLoading || selectedSale?._loading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-5 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            ))}
          </div>
        ) : selectedSale ? (
          <div className="space-y-4 text-sm">
            {/* Meta */}
            <div className="grid grid-cols-2 gap-2 text-gray-500 dark:text-gray-400">
              <div><span className="font-medium text-gray-700 dark:text-gray-300">Date:</span> {new Date(selectedSale.created_at).toLocaleString('en-GH')}</div>
              <div><span className="font-medium text-gray-700 dark:text-gray-300">Customer:</span> {selectedSale.customer?.name || 'Walk-in'}</div>
              <div><span className="font-medium text-gray-700 dark:text-gray-300">Payment:</span> {selectedSale.payment_method?.replace('_', ' ')}</div>
              <div><span className="font-medium text-gray-700 dark:text-gray-300">Status:</span> {selectedSale.payment_status}</div>
            </div>

            {/* Items */}
            <div>
              <p className="font-medium text-gray-900 dark:text-gray-100 mb-2">Items</p>
              <div className="rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-800/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-gray-400">Product</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500 dark:text-gray-400">Qty</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500 dark:text-gray-400">Price</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500 dark:text-gray-400">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {(selectedSale.items || []).map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{item.product?.name || '—'}</td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{item.quantity}</td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{formatCurrency(item.unit_price)}</td>
                        <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-gray-100">{formatCurrency(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Totals */}
            <div className="space-y-1 text-gray-600 dark:text-gray-300 border-t border-gray-100 dark:border-gray-800 pt-3">
              <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(selectedSale.subtotal)}</span></div>
              {parseFloat(selectedSale.discount_amount) > 0 && (
                <div className="flex justify-between text-red-600 dark:text-red-400"><span>Discount</span><span>- {formatCurrency(selectedSale.discount_amount)}</span></div>
              )}
              {parseFloat(selectedSale.tax_amount) > 0 && (
                <div className="flex justify-between"><span>Tax</span><span>{formatCurrency(selectedSale.tax_amount)}</span></div>
              )}
              <div className="flex justify-between font-bold text-gray-900 dark:text-gray-100 text-base pt-1">
                <span>Total</span><span>{formatCurrency(selectedSale.total_amount)}</span>
              </div>
            </div>

            {/* Payment info */}
            {selectedSale.payment && (
              <div className="space-y-1 text-gray-600 dark:text-gray-300 border-t border-gray-100 dark:border-gray-800 pt-3">
                <div className="flex justify-between"><span>Amount Paid</span><span>{formatCurrency(selectedSale.payment.amount_paid)}</span></div>
                {parseFloat(selectedSale.payment.change_given) > 0 && (
                  <div className="flex justify-between"><span>Change</span><span>{formatCurrency(selectedSale.payment.change_given)}</span></div>
                )}
                {selectedSale.payment.reference && (
                  <div className="flex justify-between"><span>Reference</span><span className="font-mono">{selectedSale.payment.reference}</span></div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </DashboardLayout>
  )
}
