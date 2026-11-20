import { useState, useEffect, useCallback, useRef } from 'react'
import toast from 'react-hot-toast'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Table } from '../components/Table'
import { Pagination } from '../components/Pagination'
import { NewPurchaseOrderModal, PurchaseOrderDetailModal, PoStatusBadge } from '../components/PurchaseOrderModals'
import { purchaseOrdersService } from '../services/purchaseOrders'
import { formatCurrency } from '../utils/formatCurrency'
import { getErrorMessage } from '../utils/apiErrors'
import { PO_STATUS } from '../utils/purchaseOrders'
import { useBranch } from '../hooks/useBranch'
import { defineColumns, type TableSort } from '../utils/tableColumns'
import type { PaginationMeta, PurchaseOrder, QueryParams, Supplier } from '../types'

const selectClass =
  'block w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'

const formatDate = (value: string | null | undefined) => (value ? new Date(value).toLocaleDateString('en-GH', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

export default function PurchaseOrdersPage() {
  const { isAllBranches } = useBranch()
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [meta, setMeta] = useState<Pick<PaginationMeta, 'page' | 'total_pages' | 'total'>>({ page: 1, total_pages: 1, total: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<TableSort>({ key: 'created_at', order: 'desc' })
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [filters, setFilters] = useState({ status: '', supplier_id: '', search: '' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const latestRequest = useRef(0)

  useEffect(() => {
    purchaseOrdersService.suppliers()
      .then((res) => setSuppliers(res.data?.data || []))
      .catch(() => {}) // the supplier filter just stays empty
  }, [])

  const fetchOrders = useCallback(async () => {
    const requestId = ++latestRequest.current
    setIsLoading(true)
    try {
      const params: QueryParams = { page, per_page: 20, sort: sort.key, order: sort.order }
      for (const [key, value] of Object.entries(filters)) if (value) params[key] = value
      const res = await purchaseOrdersService.list(params)
      if (requestId !== latestRequest.current) return
      setOrders(res.data?.data || [])
      setMeta(res.data?.meta || { page: 1, total_pages: 1, total: 0 })
    } catch (err) {
      if (requestId !== latestRequest.current) return
      toast.error(getErrorMessage(err, 'Failed to load purchase orders'))
    } finally {
      if (requestId === latestRequest.current) setIsLoading(false)
    }
  }, [page, sort, filters])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  function setFilter(key: keyof typeof filters, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }

  const closeDetail = useCallback(() => setSelectedId(null), [])

  const columns = defineColumns<PurchaseOrder>()([
    { key: 'po_number', label: 'Order', sortable: true },
    { key: 'created_at', label: 'Ordered', sortable: true, render: (v) => formatDate(v) },
    { key: 'branch', label: 'Deliver to', render: (v) => v?.name ?? '—' },
    { key: 'supplier', label: 'Supplier', sortable: true, render: (v) => v?.name ?? '—' },
    { key: 'item_count', label: 'Items' },
    { key: 'units_received', label: 'Received', render: (v, row) => `${v} of ${row.units_ordered}` },
    { key: 'total_cost', label: 'Total cost', sortable: true, render: (v) => formatCurrency(v) },
    { key: 'expected_at', label: 'Expected', sortable: true, render: (v) => formatDate(v) },
    { key: 'status', label: 'Status', sortable: true, render: (v) => <PoStatusBadge status={v} /> },
  ]).filter((col) => isAllBranches || col.key !== 'branch') // the branch only matters across branches

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Purchase Orders</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Order stock from suppliers and receive deliveries straight into inventory
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button onClick={() => setIsCreating(true)} disabled={isAllBranches}>New purchase order</Button>
            {isAllBranches && <p className="text-xs text-gray-500 dark:text-gray-400">Choose the branch the goods are for first</p>}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input label="Order number" placeholder="e.g. PO-2026…" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
            <div className="flex flex-col gap-1">
              <label htmlFor="po-filter-supplier" className="text-sm font-medium text-gray-700 dark:text-gray-300">Supplier</label>
              <select id="po-filter-supplier" value={filters.supplier_id} onChange={(e) => setFilter('supplier_id', e.target.value)} className={selectClass}>
                <option value="">All suppliers</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="po-filter-status" className="text-sm font-medium text-gray-700 dark:text-gray-300">Status</label>
              <select id="po-filter-status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={selectClass}>
                <option value="">All</option>
                {Object.entries(PO_STATUS).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <Table
            columns={columns}
            data={orders}
            isLoading={isLoading}
            sort={sort}
            onSortChange={(next) => { setSort(next); setPage(1) }}
            onRowClick={(row) => setSelectedId(row.id)}
            emptyMessage="No purchase orders yet. Create one to order stock from a supplier."
          />
        </div>

        {meta.total_pages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">Page {meta.page} of {meta.total_pages} &mdash; {meta.total} orders</p>
            <Pagination page={meta.page} total_pages={meta.total_pages} onPageChange={setPage} />
          </div>
        )}
      </div>

      {isCreating && (
        <NewPurchaseOrderModal
          onClose={() => setIsCreating(false)}
          onCreated={(po) => {
            setIsCreating(false)
            fetchOrders()
            setSelectedId(po.id)
          }}
        />
      )}
      {selectedId && <PurchaseOrderDetailModal orderId={selectedId} onClose={closeDetail} onChanged={fetchOrders} />}
    </DashboardLayout>
  )
}
