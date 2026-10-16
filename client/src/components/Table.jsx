import { useState } from 'react'

function SortIcon({ direction }) {
  return (
    <svg className={`w-3 h-3 flex-shrink-0 ${direction ? 'text-primary-600 dark:text-primary-400' : 'text-gray-300 dark:text-gray-600'}`} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      {direction !== 'desc' && <path d="M6 2l3 4H3z" />}
      {direction !== 'asc' && <path d="M6 10L3 6h6z" />}
    </svg>
  )
}

function compareValues(a, b) {
  if (a == null && b == null) return 0
  if (a == null) return 1 // empty values last
  if (b == null) return -1
  const numA = typeof a === 'number' ? a : Number(a)
  const numB = typeof b === 'number' ? b : Number(b)
  if (!Number.isNaN(numA) && !Number.isNaN(numB) && a !== '' && b !== '') return numA - numB
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })
}

/**
 * Data table with optional sortable columns.
 *
 * Column options: `sortable`, `sortKey` (field sent to the server, defaults to `key`),
 * and `sortValue(row)` (value used when sorting locally, defaults to `row[key]`).
 *
 * Pass `sort` + `onSortChange` to sort on the server (paginated lists); otherwise
 * sortable columns sort the given rows in the browser.
 */
export function Table({ columns, data, isLoading, emptyMessage = 'No data found.', onRowClick, sort, onSortChange }) {
  const [localSort, setLocalSort] = useState(null)
  const serverSorted = Boolean(onSortChange)
  const activeSort = serverSorted ? sort : localSort

  function handleSort(col) {
    const key = col.sortKey ?? col.key
    const order = activeSort?.key === key && activeSort.order === 'asc' ? 'desc' : 'asc'
    if (serverSorted) onSortChange({ key, order })
    else setLocalSort({ key, order })
  }

  let rows = data || []
  if (!serverSorted && localSort) {
    const col = columns.find((c) => (c.sortKey ?? c.key) === localSort.key)
    const getValue = col?.sortValue ?? ((row) => row[col?.key])
    rows = [...rows].sort((a, b) => compareValues(getValue(a), getValue(b)) * (localSort.order === 'desc' ? -1 : 1))
  }

  const header = (
    <thead className="bg-gray-50 dark:bg-gray-800">
      <tr>
        {columns.map((col, colIdx) => {
          const key = col.sortKey ?? col.key
          const direction = activeSort?.key === key ? activeSort.order : null
          return (
            <th
              key={`${col.key}-${colIdx}`}
              scope="col"
              aria-sort={col.sortable ? (direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none') : undefined}
              className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap"
            >
              {col.sortable ? (
                <button
                  type="button"
                  onClick={() => handleSort(col)}
                  className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-gray-700 dark:hover:text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
                  title={`Sort by ${col.label}`}
                >
                  {col.label}
                  <SortIcon direction={direction} />
                </button>
              ) : (
                col.label
              )}
            </th>
          )
        })}
      </tr>
    </thead>
  )

  if (isLoading) {
    return (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          {header}
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                {columns.map((col, colIdx) => (
                  <td key={`${col.key}-${colIdx}`} className="px-4 py-3">
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">{header}</table>
        <div className="py-12 text-center text-gray-400 dark:text-gray-600 text-sm">{emptyMessage}</div>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        {header}
        <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map((row, i) => (
            <tr
              key={row.id || i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`hover:bg-gray-50 dark:hover:bg-gray-800 transition${onRowClick ? ' cursor-pointer' : ''}`}
            >
              {columns.map((col, colIdx) => (
                <td key={`${col.key}-${colIdx}`} className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
