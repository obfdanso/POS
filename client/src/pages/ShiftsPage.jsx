import { useState, useEffect, useCallback, useRef } from 'react'
import toast from 'react-hot-toast'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Modal } from '../components/Modal'
import { Table } from '../components/Table'
import { Pagination } from '../components/Pagination'
import { Badge } from '../components/Badge'
import { ShiftSummary, CloseShiftModal, CashDifference } from '../components/ShiftModals'
import { shiftsService } from '../services/shifts'
import { usersService } from '../services/users'
import { formatCurrency } from '../utils/formatCurrency'
import { daysFromToday } from '../utils/date'
import { getErrorMessage } from '../utils/apiErrors'
import { useBranch } from '../hooks/useBranch'

const selectClass =
  'block w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'

function formatDateTime(value) {
  return value
    ? new Date(value).toLocaleString('en-GH', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—'
}

// Shows a shift's takings and drawer count; managers can close a shift a cashier left open
function ShiftDetailModal({ shiftId, onClose, onChanged }) {
  const [shift, setShift] = useState(null)
  const [isClosing, setIsClosing] = useState(false)

  useEffect(() => {
    let cancelled = false
    shiftsService.get(shiftId)
      .then((res) => { if (!cancelled) setShift(res.data.data) })
      .catch((err) => {
        if (cancelled) return
        toast.error(getErrorMessage(err, 'Failed to load shift'))
        onClose()
      })
    return () => { cancelled = true }
  }, [shiftId, onClose])

  if (isClosing && shift) {
    return (
      <CloseShiftModal
        shift={shift}
        onClose={onClose}
        onClosed={(closed) => { setShift(closed); onChanged() }}
      />
    )
  }

  return (
    <Modal isOpen onClose={onClose} title={shift ? `Shift · ${shift.user.full_name}` : 'Shift'} size="sm">
      {!shift ? (
        <div className="space-y-2 py-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-xs text-gray-400">Opened</p>
              <p className="text-gray-800 dark:text-gray-200">{formatDateTime(shift.opened_at)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Closed</p>
              <p className="text-gray-800 dark:text-gray-200">
                {shift.status === 'OPEN' ? <Badge variant="success">Open</Badge> : formatDateTime(shift.closed_at)}
              </p>
            </div>
            {shift.closed_by && shift.closed_by.id !== shift.user.id && (
              <div className="col-span-2">
                <p className="text-xs text-gray-400">Closed by</p>
                <p className="text-gray-800 dark:text-gray-200">{shift.closed_by.full_name}</p>
              </div>
            )}
          </div>
          <ShiftSummary shift={shift} />
          {shift.status === 'CLOSED' && (
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between font-semibold text-gray-900 dark:text-gray-100">
                <span>Counted</span>
                <span>{formatCurrency(shift.counted_cash)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-300">Result</span>
                <CashDifference difference={shift.difference} />
              </div>
            </div>
          )}
          {shift.notes && <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line">{shift.notes}</p>}
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={onClose}>Close</Button>
            {shift.status === 'OPEN' && (
              <Button variant="danger" className="flex-1" onClick={() => setIsClosing(true)}>Count &amp; close</Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

export default function ShiftsPage() {
  const { isAllBranches } = useBranch()
  const [shifts, setShifts] = useState([])
  const [meta, setMeta] = useState({ page: 1, total_pages: 1, total: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState({ key: 'opened_at', order: 'desc' })
  const [staff, setStaff] = useState([])
  const [filters, setFilters] = useState(() => ({
    start_date: daysFromToday(-29),
    end_date: daysFromToday(0),
    user_id: '',
    status: '',
  }))
  const [selectedShiftId, setSelectedShiftId] = useState(null)
  const latestRequest = useRef(0)

  useEffect(() => {
    usersService.staff()
      .then((res) => setStaff(res.data?.data || []))
      .catch(() => {}) // the staff filter just stays empty
  }, [])

  const fetchShifts = useCallback(async () => {
    const requestId = ++latestRequest.current
    setIsLoading(true)
    try {
      const params = { page, per_page: 20, sort: sort.key, order: sort.order }
      for (const [key, value] of Object.entries(filters)) if (value) params[key] = value
      const res = await shiftsService.list(params)
      if (requestId !== latestRequest.current) return
      setShifts(res.data?.data || [])
      setMeta(res.data?.meta || { page: 1, total_pages: 1, total: 0 })
    } catch (err) {
      if (requestId !== latestRequest.current) return
      toast.error(getErrorMessage(err, 'Failed to load shifts'))
    } finally {
      if (requestId === latestRequest.current) setIsLoading(false)
    }
  }, [page, sort, filters])

  useEffect(() => {
    fetchShifts()
  }, [fetchShifts])

  function setFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }

  const closeDetail = useCallback(() => setSelectedShiftId(null), [])

  const columns = [
    { key: 'opened_at', label: 'Opened', sortable: true, render: (v) => formatDateTime(v) },
    ...(isAllBranches ? [{ key: 'branch', label: 'Branch', render: (v) => v?.name ?? '—' }] : []),
    { key: 'user', label: 'Cashier', sortable: true, sortKey: 'cashier', render: (v) => v?.full_name ?? '—' },
    { key: 'closed_at', label: 'Closed', sortable: true, render: (v, row) => (row.status === 'OPEN' ? <Badge variant="success">Open</Badge> : formatDateTime(v)) },
    { key: 'sales_count', label: 'Sales' },
    { key: 'opening_float', label: 'Float', render: (v) => formatCurrency(v) },
    { key: 'expected_cash', label: 'Expected', render: (v) => (v == null ? '—' : formatCurrency(v)) },
    { key: 'counted_cash', label: 'Counted', render: (v) => (v == null ? '—' : formatCurrency(v)) },
    { key: 'difference', label: 'Over / short', sortable: true, render: (v) => (v == null ? '—' : <CashDifference difference={v} />) },
  ]

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Shifts</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Cash drawer sessions: the float each cashier started with, and how their count compared with the takings
          </p>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Input label="From" type="date" value={filters.start_date} max={filters.end_date || undefined} onChange={(e) => setFilter('start_date', e.target.value)} />
            <Input label="To" type="date" value={filters.end_date} min={filters.start_date || undefined} onChange={(e) => setFilter('end_date', e.target.value)} />
            <div className="flex flex-col gap-1">
              <label htmlFor="shift-status" className="text-sm font-medium text-gray-700 dark:text-gray-300">Status</label>
              <select id="shift-status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={selectClass}>
                <option value="">All</option>
                <option value="OPEN">Open</option>
                <option value="CLOSED">Closed</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="shift-cashier" className="text-sm font-medium text-gray-700 dark:text-gray-300">Cashier</label>
              <select id="shift-cashier" value={filters.user_id} onChange={(e) => setFilter('user_id', e.target.value)} className={selectClass}>
                <option value="">All staff</option>
                {staff.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <Table
            columns={columns}
            data={shifts}
            isLoading={isLoading}
            sort={sort}
            onSortChange={(next) => { setSort(next); setPage(1) }}
            onRowClick={(row) => setSelectedShiftId(row.id)}
            emptyMessage="No shifts match these filters."
          />
        </div>

        {meta.total_pages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">Page {meta.page} of {meta.total_pages} &mdash; {meta.total} shifts</p>
            <Pagination page={meta.page} total_pages={meta.total_pages} onPageChange={setPage} />
          </div>
        )}
      </div>

      {selectedShiftId && <ShiftDetailModal shiftId={selectedShiftId} onClose={closeDetail} onChanged={fetchShifts} />}
    </DashboardLayout>
  )
}
