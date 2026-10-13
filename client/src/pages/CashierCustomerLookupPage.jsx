import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { DashboardLayout } from '../layouts/DashboardLayout'
import api from '../services/api'

function StarIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  )
}

export default function CashierCustomerLookupPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  // Results belong to `searchedFor`; they're hidden as soon as the box is cleared
  const [results, setResults] = useState({ searchedFor: '', customers: [] })
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)

  // Debounced search
  useEffect(() => {
    const q = query.trim()
    if (!q) return
    const timer = setTimeout(() => {
      setLoading(true)
      api.get('/customers', { params: { search: q, per_page: 20 } })
        .then((res) => setResults({ searchedFor: q, customers: res.data.data || [] }))
        .catch(() => setResults({ searchedFor: q, customers: [] }))
        .finally(() => setLoading(false))
    }, 350)
    return () => clearTimeout(timer)
  }, [query])

  const searched = query.trim() !== '' && results.searchedFor !== ''
  const customers = query.trim() ? results.customers : []

  return (
    <DashboardLayout>
      <div className="max-w-2xl space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Customer Lookup</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Search by name or phone number</p>
        </div>

        {/* Search bar */}
        <div className="relative">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
            {loading ? (
              <svg className="w-4 h-4 text-teal-500 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            )}
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter name or phone number..."
            autoFocus
            className="w-full pl-10 pr-4 py-3 border border-gray-200 dark:border-gray-700 rounded-full text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500 transition shadow-sm"
          />
          {query && (
            <button
              onClick={() => { setQuery(''); inputRef.current?.focus() }}
              className="absolute inset-y-0 right-4 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Results */}
        {!searched && !query && (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-sm">Start typing to search customers</p>
          </div>
        )}

        {searched && !loading && customers.length === 0 && (
          <div className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">
            No customers found matching &quot;{results.searchedFor}&quot;
          </div>
        )}

        {customers.length > 0 && (
          <div className="space-y-3">
            {customers.map((customer) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => navigate(`/cashier/customers/${customer.id}`)}
                className="w-full text-left bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 px-5 py-4 shadow-sm hover:border-teal-400 dark:hover:border-teal-600 hover:bg-teal-50/40 dark:hover:bg-teal-900/10 transition-colors cursor-pointer group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 flex items-center justify-center font-bold text-sm flex-shrink-0">
                      {customer.name?.[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{customer.name}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {customer.phone && <span>{customer.phone}</span>}
                        {customer.email && <span className="truncate">{customer.email}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="flex items-center gap-1 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1 rounded-full">
                      <StarIcon />
                      <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">{customer.loyalty_points ?? 0} pts</span>
                    </div>
                    <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-teal-500 dark:group-hover:text-teal-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
