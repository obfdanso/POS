import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Modal } from '../components/Modal'
import { Table } from '../components/Table'
import { Pagination } from '../components/Pagination'
import { Badge } from '../components/Badge'
import { Receipt } from '../components/Receipt'
import { salesService } from '../services/sales'
import { usersService } from '../services/users'
import { useSettings } from '../context/SettingsContext'
import { formatCurrency } from '../utils/formatCurrency'
import { daysFromToday } from '../utils/date'
import { getErrorMessage } from '../utils/apiErrors'

const STATUS_BADGE = { COMPLETED: 'success', REFUNDED: 'danger', PENDING: 'warning' }
const METHOD_BADGE = { CASH: 'default', MOBILE_MONEY: 'primary', CARD: 'success' }

const selectClass =
  'block w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'

function formatDateTime(value) {
  return new Date(value).toLocaleString('en-GH', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Shows a sale's receipt with reprint, and lets managers/admins refund completed sales
function SaleDetailModal({ saleId, onClose, onRefunded }) {
  const { loyalty_points_rate } = useSettings()
  const [sale, setSale] = useState(null)
  const [confirmingRefund, setConfirmingRefund] = useState(false)
  const [isRefunding, setIsRefunding] = useState(false)

  useEffect(() => {
    salesService.get(saleId)
      .then((res) => setSale(res.data?.data))
      .catch((err) => {
        toast.error(getErrorMessage(err, 'Failed to load sale'))
        onClose()
      })
  }, [saleId, onClose])

  async function handleRefund() {
    setIsRefunding(true)
    try {
      const res = await salesService.refund(sale.id)
      setSale(res.data?.data)
      setConfirmingRefund(false)
      toast.success(`${sale.transaction_id} refunded and stock restored`)
      onRefunded()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Refund failed'))
    } finally {
      setIsRefunding(false)
    }
  }

  const loyaltyRate = parseFloat(loyalty_points_rate) || 0
  const pointsToReverse = sale?.customer && loyaltyRate > 0 ? Math.floor(parseFloat(sale.total_amount) / loyaltyRate) : 0
  const unitsToRestore = sale?.items?.reduce((sum, i) => sum + i.quantity, 0) ?? 0

  return (
    <>
      <Modal isOpen={!confirmingRefund} onClose={onClose} title={sale ? `Sale ${sale.transaction_id}` : 'Sale details'} size="md">
        {!sale ? (
          <div className="space-y-3 animate-pulse">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
            ))}
          </div>
        ) : (
          <Receipt
            sale={sale}
            onClose={onClose}
            actions={
              sale.payment_status === 'COMPLETED' && (
                <Button variant="danger" onClick={() => setConfirmingRefund(true)}>
                  Refund
                </Button>
              )
            }
          />
        )}
      </Modal>

      <Modal isOpen={confirmingRefund} onClose={() => setConfirmingRefund(false)} title="Refund sale" size="sm">
        {sale && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Refund <span className="font-semibold text-gray-900 dark:text-gray-100">{formatCurrency(sale.total_amount)}</span> for{' '}
              <span className="font-mono">{sale.transaction_id}</span>? This cannot be undone.
            </p>
            <ul className="text-sm text-gray-600 dark:text-gray-400 list-disc pl-5 space-y-1">
              <li>{unitsToRestore} unit{unitsToRestore !== 1 ? 's' : ''} will be returned to stock</li>
              {pointsToReverse > 0 && (
                <li>{pointsToReverse} loyalty point{pointsToReverse !== 1 ? 's' : ''} will be removed from {sale.customer.name}</li>
              )}
              <li>Pay the customer back via {sale.payment_method.replace('_', ' ').toLowerCase()} yourself — the system only records the refund</li>
            </ul>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmingRefund(false)} disabled={isRefunding}>
                Cancel
              </Button>
              <Button variant="danger" className="flex-1" onClick={handleRefund} isLoading={isRefunding}>
                Confirm refund
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

export default function SalesPage() {
  const [sales, setSales] = useState([])
  const [meta, setMeta] = useState({ page: 1, total_pages: 1, total: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [staff, setStaff] = useState([])

  const [page, setPage] = useState(1)
  const [sort, setSort] = useState({ key: 'created_at', order: 'desc' })
  const [filters, setFilters] = useState(() => ({
    start_date: daysFromToday(-29),
    end_date: daysFromToday(0),
    payment_status: '',
    payment_method: '',
    user_id: '',
    search: '',
  }))
  const [selectedSaleId, setSelectedSaleId] = useState(null)

  useEffect(() => {
    usersService.staff()
      .then((res) => setStaff(res.data?.data || []))
      .catch(() => {}) // cashier filter just stays empty
  }, [])

  const fetchSales = useCallback(async () => {
    setIsLoading(true)
    try {
      const params = { page, per_page: 20, sort: sort.key, order: sort.order }
      for (const [key, value] of Object.entries(filters)) {
        if (value) params[key] = typeof value === 'string' ? value.trim() : value
      }
      const res = await salesService.list(params)
      setSales(res.data?.data || [])
      setMeta(res.data?.meta || { page: 1, total_pages: 1, total: 0 })
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load sales'))
    } finally {
      setIsLoading(false)
    }
  }, [page, sort, filters])

  // Debounce so typing a transaction ID doesn't fire a request per keystroke
  useEffect(() => {
    const id = setTimeout(fetchSales, 250)
    return () => clearTimeout(id)
  }, [fetchSales])

  function setFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }

  function handleSortChange(next) {
    setSort(next)
    setPage(1)
  }

  const closeDetail = useCallback(() => setSelectedSaleId(null), [])

  const columns = [
    { key: 'created_at', label: 'Date', sortable: true, render: (v) => formatDateTime(v) },
    {
      key: 'transaction_id',
      label: 'Transaction',
      sortable: true,
      render: (v) => <span className="font-mono text-xs font-medium text-primary-700 dark:text-primary-400">{v}</span>,
    },
    { key: 'user', label: 'Cashier', sortable: true, sortKey: 'cashier', render: (v) => v?.full_name ?? '—' },
    {
      key: 'customer',
      label: 'Customer',
      sortable: true,
      render: (v) => v?.name ?? <span className="text-gray-400 italic">Walk-in</span>,
    },
    { key: 'items_count', label: 'Items' },
    {
      key: 'payment_method',
      label: 'Payment',
      sortable: true,
      render: (v) => <Badge variant={METHOD_BADGE[v] ?? 'default'}>{v.replace('_', ' ')}</Badge>,
    },
    {
      key: 'total_amount',
      label: 'Total',
      sortable: true,
      render: (v, row) => (
        <span className={`font-semibold ${row.payment_status === 'REFUNDED' ? 'line-through text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>
          {formatCurrency(v)}
        </span>
      ),
    },
    {
      key: 'payment_status',
      label: 'Status',
      sortable: true,
      render: (v) => <Badge variant={STATUS_BADGE[v] ?? 'default'}>{v}</Badge>,
    },
  ]

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Sales</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {isLoading && sales.length === 0
              ? 'Loading sales…'
              : `${meta.total} sale${meta.total !== 1 ? 's' : ''} in this period · click a sale to reprint its receipt or refund it`}
          </p>
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Input
              label="Transaction ID"
              placeholder="e.g. TXN-2026…"
              value={filters.search}
              onChange={(e) => setFilter('search', e.target.value)}
            />
            <Input
              label="From"
              type="date"
              value={filters.start_date}
              max={filters.end_date || undefined}
              onChange={(e) => setFilter('start_date', e.target.value)}
            />
            <Input
              label="To"
              type="date"
              value={filters.end_date}
              min={filters.start_date || undefined}
              onChange={(e) => setFilter('end_date', e.target.value)}
            />
            <div className="flex flex-col gap-1">
              <label htmlFor="sales-status" className="text-sm font-medium text-gray-700 dark:text-gray-300">Status</label>
              <select id="sales-status" value={filters.payment_status} onChange={(e) => setFilter('payment_status', e.target.value)} className={selectClass}>
                <option value="">All statuses</option>
                <option value="COMPLETED">Completed</option>
                <option value="REFUNDED">Refunded</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="sales-method" className="text-sm font-medium text-gray-700 dark:text-gray-300">Payment</label>
              <select id="sales-method" value={filters.payment_method} onChange={(e) => setFilter('payment_method', e.target.value)} className={selectClass}>
                <option value="">All methods</option>
                <option value="CASH">Cash</option>
                <option value="MOBILE_MONEY">Mobile Money</option>
                <option value="CARD">Card</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="sales-cashier" className="text-sm font-medium text-gray-700 dark:text-gray-300">Cashier</label>
              <select id="sales-cashier" value={filters.user_id} onChange={(e) => setFilter('user_id', e.target.value)} className={selectClass}>
                <option value="">All staff</option>
                {staff.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <Table
            columns={columns}
            data={sales}
            isLoading={isLoading}
            sort={sort}
            onSortChange={handleSortChange}
            onRowClick={(row) => setSelectedSaleId(row.id)}
            emptyMessage="No sales match these filters."
          />
        </div>

        {meta.total_pages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Page {meta.page} of {meta.total_pages} &mdash; {meta.total} results
            </p>
            <Pagination page={meta.page} total_pages={meta.total_pages} onPageChange={setPage} />
          </div>
        )}
      </div>

      {selectedSaleId && <SaleDetailModal saleId={selectedSaleId} onClose={closeDetail} onRefunded={fetchSales} />}
    </DashboardLayout>
  )
}
