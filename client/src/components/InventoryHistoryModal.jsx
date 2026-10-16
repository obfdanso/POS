import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { Modal } from './Modal'
import { Badge } from './Badge'
import { Pagination } from './Pagination'
import { inventoryService } from '../services/inventory'
import { getErrorMessage } from '../utils/apiErrors'

const TYPE_BADGE = { SALE: 'primary', RESTOCK: 'success', ADJUSTMENT: 'warning', RETURN: 'default' }

/** Paginated stock-change history (Inventory_Log) for one product. */
export function InventoryHistoryModal({ product, onClose }) {
  const [logs, setLogs] = useState(null)
  const [meta, setMeta] = useState({ page: 1, total_pages: 1, total: 0 })
  const [page, setPage] = useState(1)

  useEffect(() => {
    let cancelled = false
    inventoryService.log(product.id, { page, per_page: 15 })
      .then((res) => {
        if (cancelled) return
        setLogs(res.data?.data || [])
        setMeta(res.data?.meta || { page: 1, total_pages: 1, total: 0 })
      })
      .catch((err) => toast.error(getErrorMessage(err, 'Failed to load stock history')))
    return () => {
      cancelled = true
    }
  }, [product.id, page])

  return (
    <Modal isOpen onClose={onClose} title={`Stock history — ${product.name}`} size="xl">
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
        {product.sku} · {product.quantity} in stock now · {meta.total} change{meta.total !== 1 ? 's' : ''} recorded
      </p>

      <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-800">
        <table className="min-w-full text-sm divide-y divide-gray-100 dark:divide-gray-800">
          <thead className="bg-gray-50 dark:bg-gray-800 text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">When</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Type</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Change</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Stock</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">By</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-900">
            {logs === null
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={6} className="px-3 py-3">
                      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              : logs.length === 0
                ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-gray-400">No stock changes recorded yet.</td>
                  </tr>
                )
                : logs.map((log) => (
                  <tr key={log.id}>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400">
                      {new Date(log.created_at).toLocaleString('en-GH', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-3 py-2"><Badge variant={TYPE_BADGE[log.change_type] ?? 'default'}>{log.change_type}</Badge></td>
                    <td className={`px-3 py-2 text-right font-semibold ${log.quantity_change > 0 ? 'text-success-600' : 'text-danger-600'}`}>
                      {log.quantity_change > 0 ? `+${log.quantity_change}` : log.quantity_change}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap text-gray-600 dark:text-gray-400">
                      {log.previous_quantity} → <span className="font-medium text-gray-900 dark:text-gray-100">{log.new_quantity}</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400">{log.user?.full_name ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 max-w-xs truncate" title={log.notes ?? ''}>{log.notes ?? '—'}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {meta.total_pages > 1 && (
        <div className="flex justify-end mt-3">
          <Pagination page={meta.page} total_pages={meta.total_pages} onPageChange={setPage} />
        </div>
      )}
    </Modal>
  )
}
