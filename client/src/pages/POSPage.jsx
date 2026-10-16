import { useState, useEffect, useRef, useCallback } from 'react'
import toast from 'react-hot-toast'
import { useCart } from '../context/CartContext'
import { productsService } from '../services/products'
import { salesService } from '../services/sales'
import { customersService } from '../services/customers'
import { formatCurrency } from '../utils/formatCurrency'
import { lineTotal, round2 } from '../utils/saleTotals'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Modal } from '../components/Modal'
import { Badge } from '../components/Badge'
import { Receipt } from '../components/Receipt'
import { useAuth } from '../hooks/useAuth'
import { useSettings } from '../context/SettingsContext'
import { DashboardLayout } from '../layouts/DashboardLayout'

// ─── Payment Modal ─────────────────────────────────────────────────────────────
// Suggested cash amounts: exact, then the next round notes above the total
function quickCashAmounts(total) {
  const options = [total]
  for (const step of [5, 10, 20, 50, 100]) {
    const rounded = Math.ceil(total / step) * step
    if (rounded > total && !options.includes(rounded)) options.push(rounded)
  }
  return options.slice(0, 4)
}

function PaymentModal({ isOpen, onClose, total, onConfirm, isLoading, selectedCustomer }) {
  const { currency_symbol, store_name } = useSettings()
  const sym = currency_symbol || 'GH₵'
  const fmt = (v) => formatCurrency(v, sym)

  const [method, setMethod] = useState('CASH')
  const [amountPaid, setAmountPaid] = useState('')
  const [errors, setErrors] = useState({})

  const paid = parseFloat(amountPaid)
  const change = method === 'CASH' && paid >= total ? paid - total : 0

  function validate() {
    const errs = {}
    if (method === 'CASH' && (isNaN(paid) || paid < total)) {
      errs.amountPaid = `Amount must be at least ${fmt(total)}`
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  function handleConfirm() {
    if (isLoading) return
    if (method === 'CASH') {
      if (!validate()) return
      onConfirm({ payment_method: 'CASH', amount_paid: paid })
      return
    }

    // CARD or MOBILE_MONEY — open Paystack popup
    const publicKey = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY
    if (!window.PaystackPop || !publicKey) {
      toast.error('Card and Mobile Money payments are not configured. Add VITE_PAYSTACK_PUBLIC_KEY to client/.env')
      return
    }
    const handler = window.PaystackPop.setup({
      key: publicKey,
      email: selectedCustomer?.email || 'guest@quickmart.com',
      amount: Math.round(total * 100), // Paystack uses pesewas; must equal the server-side sale total
      currency: 'GHS',
      ref: 'QM-' + Date.now() + '-' + Math.floor(Math.random() * 1000000),
      channels: method === 'CARD' ? ['card'] : ['mobile_money'],
      metadata: {
        custom_fields: [{ display_name: 'Store', variable_name: 'store', value: store_name || 'QuickMart' }],
      },
      onClose: () => {
        toast.error('Payment was cancelled')
      },
      callback: (response) => {
        onConfirm({ payment_method: method, amount_paid: total, reference: response.reference })
      },
    })
    handler.openIframe()
  }

  const methods = [
    { value: 'CASH', label: 'Cash' },
    { value: 'MOBILE_MONEY', label: 'Mobile Money' },
    { value: 'CARD', label: 'Card' },
  ]

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Process Payment" size="sm">
      <div className="space-y-4">
        {/* Total */}
        <div className="bg-primary-50 border border-primary-100 rounded-lg p-4 text-center">
          <p className="text-sm text-primary-600 font-medium">Amount Due</p>
          <p className="text-3xl font-bold text-primary-700 mt-1">{fmt(total)}</p>
        </div>

        {/* Payment Method */}
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Payment Method</p>
          <div className="grid grid-cols-3 gap-2">
            {methods.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => { setMethod(m.value); setErrors({}) }}
                className={`py-2.5 px-3 rounded-full border text-sm font-medium transition ${
                  method === m.value
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Cash: amount paid */}
        {method === 'CASH' && (
          <div className="space-y-2">
            <Input
              label={`Amount Paid (${sym})`}
              type="number"
              min={total}
              step="0.01"
              value={amountPaid}
              onChange={(e) => { setAmountPaid(e.target.value); setErrors({}) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleConfirm() } }}
              placeholder={total.toFixed(2)}
              error={errors.amountPaid}
              autoFocus
            />
            <div className="flex gap-2">
              {quickCashAmounts(total).map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => { setAmountPaid(amt.toFixed(2)); setErrors({}) }}
                  className="flex-1 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300 hover:border-primary-400 hover:text-primary-600 transition"
                >
                  {amt === total ? 'Exact' : fmt(amt)}
                </button>
              ))}
            </div>
            {paid >= total && (
              <div className="flex justify-between items-center bg-success-50 border border-success-100 rounded-lg px-3 py-2">
                <span className="text-sm text-success-700">Change</span>
                <span className="font-bold text-success-700">{fmt(change)}</span>
              </div>
            )}
          </div>
        )}

        {/* Card / Mobile Money: Paystack handles payment details in its popup */}
        {(method === 'MOBILE_MONEY' || method === 'CARD') && (
          <div className="rounded-lg border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-primary-700">
            A secure Paystack payment window will open to complete this transaction.
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={isLoading}>Cancel</Button>
          <Button variant="success" className="flex-1" onClick={handleConfirm} isLoading={isLoading} title="Enter">
            Confirm Payment
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Customer Search Modal ─────────────────────────────────────────────────────
function CustomerModal({ isOpen, onClose, onSelect }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!isOpen) { setQuery(''); setResults([]) }
  }, [isOpen])

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const id = setTimeout(async () => {
      setIsLoading(true)
      try {
        const res = await customersService.list({ search: query, per_page: 10 })
        setResults(res.data?.data || [])
      } catch {
        setResults([])
      } finally {
        setIsLoading(false)
      }
    }, 300)
    return () => clearTimeout(id)
  }, [query])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Select Customer" size="md">
      <div className="space-y-3">
        <Input
          placeholder="Search by name or phone..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {isLoading && <p className="text-sm text-gray-400 text-center py-2">Searching...</p>}
        {!isLoading && results.length === 0 && query && (
          <p className="text-sm text-gray-400 text-center py-2">No customers found.</p>
        )}
        <ul className="divide-y divide-gray-100 dark:divide-gray-800 max-h-64 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-700">
          {results.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => { onSelect(c); onClose() }}
                className="w-full text-left px-4 py-3 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition"
              >
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{c.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{c.phone || c.email || 'No contact info'} &bull; {c.loyalty_points} pts</p>
              </button>
            </li>
          ))}
        </ul>
        <div className="pt-1">
          <Button variant="ghost" size="sm" onClick={() => { onSelect(null); onClose() }} className="w-full">
            Clear Customer (Walk-in)
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Cart Item Row ─────────────────────────────────────────────────────────────
function CartItem({ item, fmt, onUpdate, onRemove, onDiscountChange }) {
  const lineGross = round2(parseFloat(item.price) * item.quantity)
  const clampQty = (q) => Math.min(Math.max(q, 1), item.quantity_available)
  return (
    <div className="py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{item.name}</p>
          <p className="text-xs text-gray-400">{fmt(item.price)} each · {item.quantity_available} in stock</p>
        </div>
        <button
          onClick={() => onRemove(item.product_id)}
          className="text-gray-300 hover:text-danger-500 transition flex-shrink-0 p-0.5"
          title="Remove item"
          aria-label="Remove item"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex items-center justify-between mt-1.5 gap-2">
        {/* Quantity controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onUpdate(item.product_id, item.quantity - 1)}
            aria-label="Decrease quantity"
            className="w-6 h-6 rounded border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition text-sm"
          >
            −
          </button>
          <input
            type="number"
            min={1}
            max={item.quantity_available}
            value={item.quantity}
            onChange={(e) => onUpdate(item.product_id, clampQty(parseInt(e.target.value) || 1))}
            aria-label={`Quantity of ${item.name}`}
            className="w-12 text-center text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded py-0.5 focus:outline-none focus:ring-1 focus:ring-primary-400"
          />
          <button
            onClick={() => onUpdate(item.product_id, item.quantity + 1)}
            disabled={item.quantity >= item.quantity_available}
            aria-label="Increase quantity"
            className="w-6 h-6 rounded border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition text-sm disabled:opacity-40"
          >
            +
          </button>
        </div>

        {/* Item discount */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-400">disc:</span>
          <input
            type="number"
            min={0}
            max={lineGross}
            step="0.01"
            value={item.discount || ''}
            placeholder="0"
            onChange={(e) => onDiscountChange(item.product_id, Math.min(Math.max(parseFloat(e.target.value) || 0, 0), lineGross))}
            aria-label={`Discount on ${item.name}`}
            className="w-16 text-right text-xs border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded py-0.5 px-1 focus:outline-none focus:ring-1 focus:ring-primary-400"
          />
        </div>

        {/* Line total */}
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 min-w-[70px] text-right">
          {fmt(lineTotal(item.price, item.quantity, item.discount))}
        </p>
      </div>
    </div>
  )
}

// ─── Main POSPage ──────────────────────────────────────────────────────────────
function isTypingTarget(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

export default function POSPage() {
  const { user } = useAuth()
  const { loyalty_points_rate, currency_symbol, refreshSettings } = useSettings()
  const fmt = (v) => formatCurrency(v, currency_symbol || 'GH₵')
  const { items, cartDiscount, customer, subtotal, taxAmount, taxRate, total, addItem, removeItem, updateQuantity, updateDiscount, setCartDiscount, setCustomer, clearCart } = useCart()

  const [searchQuery, setSearchQuery] = useState('')
  const [products, setProducts] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [categories, setCategories] = useState([])
  const [activeCategory, setActiveCategory] = useState('')
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showReceiptModal, setShowReceiptModal] = useState(false)
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [completedSale, setCompletedSale] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const searchRef = useRef(null)
  const barcodeBufferRef = useRef('')
  const barcodeTimerRef = useRef(null)
  // Latest cart items, readable from long-lived event listeners without stale closures
  const itemsRef = useRef(items)
  itemsRef.current = items

  const anyModalOpen = showPaymentModal || showReceiptModal || showCustomerModal || showClearConfirm

  // Focus search on mount, and pick up any tax/loyalty changes an admin made since login
  useEffect(() => {
    searchRef.current?.focus()
    refreshSettings()
  }, [refreshSettings])

  useEffect(() => {
    productsService.categories()
      .then((res) => setCategories(res.data?.data || []))
      .catch(() => {})
  }, [])

  // Adds a product unless that would exceed the stock on hand. Returns true when added.
  const tryAddProduct = useCallback((product) => {
    const inCart = itemsRef.current.find((i) => i.product_id === product.id)?.quantity || 0
    if (product.quantity === 0) {
      toast.error(`${product.name} is out of stock`)
      return false
    }
    if (inCart >= product.quantity) {
      toast.error(`Only ${product.quantity} ${product.name} in stock`)
      return false
    }
    addItem(product)
    return true
  }, [addItem])

  // Resolves a typed or scanned code (barcode, SKU, or a unique name match) and adds it to the cart
  const addByCode = useCallback(async (code) => {
    const q = code.trim()
    if (!q) return false
    try {
      if (/^\d{6,}$/.test(q)) {
        const res = await productsService.byBarcode(q).catch(() => null)
        const product = res?.data?.data
        if (product) {
          if (tryAddProduct(product)) toast.success(`${product.name} added`)
          return true
        }
      }
      const res = await productsService.list({ search: q, per_page: 5 })
      const results = res.data?.data || []
      const lower = q.toLowerCase()
      const exact = results.find((p) => p.sku.toLowerCase() === lower || p.barcode === q)
      const match = exact || (results.length === 1 ? results[0] : null)
      if (match) {
        if (tryAddProduct(match)) toast.success(`${match.name} added`)
        return true
      }
      toast.error(results.length ? 'Several products match — pick one from the list' : `No product found for "${q}"`)
      return false
    } catch {
      toast.error('Product lookup failed')
      return false
    }
  }, [tryAddProduct])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'F1') { e.preventDefault(); searchRef.current?.focus() }
      if (e.key === 'F2') {
        e.preventDefault()
        if (items.length > 0 && !anyModalOpen) setShowPaymentModal(true)
      }
      if (e.key === 'F4') {
        e.preventDefault()
        if (items.length > 0 && !anyModalOpen) setShowClearConfirm(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [items.length, anyModalOpen])

  // Barcode scanner detection when focus is outside any input: rapid keystrokes ending with Enter.
  // (When the search box is focused, its own Enter handler resolves the code.)
  // Registered once; current state is read through refs so the buffer's reset timer survives re-renders.
  const addByCodeRef = useRef(addByCode)
  addByCodeRef.current = addByCode
  const scanBlockedRef = useRef(false)
  // A scan may start the next sale while the receipt is still showing; other dialogs block scans
  scanBlockedRef.current = showPaymentModal || showCustomerModal || showClearConfirm
  const receiptOpenRef = useRef(false)
  receiptOpenRef.current = showReceiptModal

  useEffect(() => {
    function onKeyDown(e) {
      if (isTypingTarget(e.target) || scanBlockedRef.current) return
      if (e.key === 'Enter' && barcodeBufferRef.current.length >= 6) {
        // The Enter belongs to the scan, so it must not also activate the focused button
        e.preventDefault()
        const barcode = barcodeBufferRef.current
        barcodeBufferRef.current = ''
        clearTimeout(barcodeTimerRef.current)
        if (receiptOpenRef.current) setShowReceiptModal(false)
        addByCodeRef.current(barcode)
        return
      }
      if (e.key.length === 1) {
        barcodeBufferRef.current += e.key
        clearTimeout(barcodeTimerRef.current)
        barcodeTimerRef.current = setTimeout(() => { barcodeBufferRef.current = '' }, 100)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); clearTimeout(barcodeTimerRef.current) }
  }, [])

  // Product grid: debounced search, or browse by category when the search box is empty
  useEffect(() => {
    const query = searchQuery.trim()
    setIsSearching(true)
    const id = setTimeout(async () => {
      try {
        const params = { per_page: query ? 20 : 40 }
        if (query) params.search = query
        if (activeCategory) params.category_id = activeCategory
        const res = await productsService.list(params)
        setProducts(res.data?.data || [])
      } catch {
        setProducts([])
      } finally {
        setIsSearching(false)
      }
    }, query ? 300 : 0)
    return () => clearTimeout(id)
  }, [searchQuery, activeCategory])

  function handleAddProduct(product) {
    tryAddProduct(product)
    setSearchQuery('')
    searchRef.current?.focus()
  }

  async function handleSearchKeyDown(e) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const code = searchQuery
    if (!code.trim()) return
    setSearchQuery('')
    const added = await addByCode(code)
    // Put an unrecognised code back so it can be corrected, unless the cashier has moved on
    if (!added) setSearchQuery((current) => current || code)
  }

  async function handlePaymentConfirm({ payment_method, amount_paid, reference }) {
    setIsSubmitting(true)
    try {
      const payload = {
        items: items.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          discount: i.discount || 0,
        })),
        customer_id: customer?.id || null,
        payment_method,
        amount_paid,
        discount_amount: cartDiscount || 0,
        ...(reference ? { reference } : {}),
      }
      const res = await salesService.create(payload)
      const sale = res.data?.data
      setCompletedSale(sale)
      setShowPaymentModal(false)
      setShowReceiptModal(true)
      clearCart()
      // Reflect the sold quantities in the visible grid
      setProducts((prev) => prev.map((p) => {
        const sold = sale.items?.find((i) => i.product_id === p.id)
        return sold ? { ...p, quantity: p.quantity - sold.quantity } : p
      }))

      // Track in sessionStorage so the cashier dashboard shows this session's sales only
      try {
        const prev = JSON.parse(sessionStorage.getItem('pos_session_sales') || '[]')
        prev.unshift({
          id: sale.id,
          transaction_id: sale.transaction_id,
          created_at: sale.created_at,
          customer_name: sale.customer?.name || null,
          payment_method: sale.payment_method,
          total_amount: sale.total_amount,
        })
        sessionStorage.setItem('pos_session_sales', JSON.stringify(prev.slice(0, 10)))
      } catch {
        // sessionStorage unavailable — non-critical
      }
      toast.success(reference ? `Payment successful! Ref: ${reference}` : 'Sale completed successfully!')
    } catch (err) {
      const apiError = err.response?.data?.error
      toast.error(apiError?.details?.[0]?.message || apiError?.message || 'Failed to process sale')
    } finally {
      setIsSubmitting(false)
    }
  }

  function closeReceipt() {
    setShowReceiptModal(false)
    searchRef.current?.focus()
  }

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0)
  const loyaltyRate = parseFloat(loyalty_points_rate) || 0
  const pointsEarned = customer && loyaltyRate > 0 ? Math.floor(total / loyaltyRate) : 0

  return (
    <DashboardLayout noPad>
    <div className="flex h-[calc(100vh-4rem)] bg-gray-100 dark:bg-gray-950 overflow-hidden">
      {/* ── LEFT PANEL: Product search & selection (~60%) ── */}
      <div className="flex flex-col flex-1 min-w-0 p-4 gap-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">New Sale</h1>
            <p className="text-xs text-gray-400">
              <kbd className="bg-gray-200 dark:bg-gray-800 px-1 rounded text-xs">F1</kbd> Search &nbsp;
              <kbd className="bg-gray-200 dark:bg-gray-800 px-1 rounded text-xs">F2</kbd> Pay &nbsp;
              <kbd className="bg-gray-200 dark:bg-gray-800 px-1 rounded text-xs">F4</kbd> Clear &nbsp;
              <kbd className="bg-gray-200 dark:bg-gray-800 px-1 rounded text-xs">↵</kbd> Add / Confirm
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Cashier</p>
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{user?.full_name || '—'}</p>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search by name, SKU, or scan barcode — Enter adds (F1)"
            title="F1 to focus · Enter adds the matching product"
            className="w-full pl-9 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); searchRef.current?.focus() }}
              aria-label="Clear search"
              className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Category filter */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[{ id: '', name: 'All' }, ...categories].map((cat) => (
            <button
              key={cat.id || 'all'}
              type="button"
              onClick={() => setActiveCategory(cat.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition ${
                activeCategory === cat.id
                  ? 'bg-primary-600 border-primary-600 text-white'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-primary-300'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-y-auto">
          {isSearching && products.length === 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="bg-white dark:bg-gray-900 rounded-xl p-3 animate-pulse">
                  <div className="h-20 bg-gray-100 dark:bg-gray-800 rounded-lg mb-2" />
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
                  <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-2/3" />
                </div>
              ))}
            </div>
          )}

          {!isSearching && products.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <svg className="w-12 h-12 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm">{searchQuery ? `No products found for "${searchQuery}"` : 'No products in this category'}</p>
            </div>
          )}

          {products.length > 0 && (
            <div className={`grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 transition-opacity ${isSearching ? 'opacity-60' : ''}`}>
              {products.map((product) => (
                <button
                  key={product.id}
                  onClick={() => handleAddProduct(product)}
                  disabled={product.quantity === 0}
                  className="bg-white dark:bg-gray-900 rounded-xl p-3 text-left shadow-sm border border-gray-100 dark:border-gray-800 transition hover:shadow-md hover:border-primary-300 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {product.image_url ? (
                    <img src={product.image_url} alt={product.name} loading="lazy" className="w-full h-20 object-cover rounded-lg mb-2" />
                  ) : (
                    <div className="w-full h-20 bg-gray-100 dark:bg-gray-800 rounded-lg mb-2 flex items-center justify-center">
                      <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                    </div>
                  )}
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{product.name}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{product.sku}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-sm font-bold text-primary-600">{fmt(product.price)}</span>
                    <Badge variant={product.quantity === 0 ? 'danger' : product.quantity <= product.low_stock_threshold ? 'warning' : 'success'}>
                      {product.quantity === 0 ? 'Out' : `${product.quantity}`}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL: Cart + Payment (~40%) ── */}
      <div className="w-[40%] min-w-[340px] max-w-[480px] flex-shrink-0 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 flex flex-col shadow-xl">
        {/* Cart header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Cart</h2>
            {itemCount > 0 && (
              <Badge variant="primary">{itemCount} item{itemCount !== 1 ? 's' : ''}</Badge>
            )}
          </div>
          {items.length > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="text-xs text-danger-500 hover:text-danger-700 transition"
              title="Clear cart (F4)"
            >
              Clear (F4)
            </button>
          )}
        </div>

        {/* Cart items */}
        <div className="flex-1 overflow-y-auto px-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-300 py-8">
              <svg className="w-12 h-12 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
              <p className="text-sm">Cart is empty</p>
              <p className="text-xs">Search or scan products to add</p>
            </div>
          ) : (
            <div>
              {items.map((item) => (
                <CartItem
                  key={item.product_id}
                  item={item}
                  fmt={fmt}
                  onUpdate={updateQuantity}
                  onRemove={removeItem}
                  onDiscountChange={updateDiscount}
                />
              ))}
            </div>
          )}
        </div>

        {/* Totals + actions */}
        <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-3 space-y-2.5">
          {/* Customer selector (optional — walk-in customers need no registration) */}
          {customer ? (
            <div className="flex items-center justify-between gap-2 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <svg className="w-4 h-4 text-primary-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-primary-700 dark:text-primary-300 truncate">{customer.name}</p>
                  <p className="text-xs text-primary-500 dark:text-primary-400">
                    {customer.loyalty_points ?? 0} pts
                    {pointsEarned > 0 && <span className="text-success-600 dark:text-success-400"> · +{pointsEarned} pts this sale</span>}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setCustomer(null)}
                aria-label="Remove customer"
                className="text-primary-400 hover:text-danger-500 transition flex-shrink-0"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowCustomerModal(true)}
              className="w-full flex items-center justify-between gap-2 border border-dashed rounded-lg px-3 py-2 text-sm transition border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-primary-400 hover:text-primary-500 dark:hover:text-primary-400"
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>Walk-in · add customer for loyalty</span>
              </div>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          )}

          {/* Cart discount */}
          <div className="flex items-center gap-3">
            <label htmlFor="cart-discount" className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">Cart Discount</label>
            <input
              id="cart-discount"
              type="number"
              min={0}
              max={subtotal}
              step="0.01"
              value={cartDiscount || ''}
              onChange={(e) => setCartDiscount(Math.min(Math.max(parseFloat(e.target.value) || 0, 0), subtotal))}
              placeholder="0.00"
              className="flex-1 text-right border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg py-1.5 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Subtotal */}
          <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
            <span>Subtotal</span>
            <span>{fmt(subtotal)}</span>
          </div>
          {(cartDiscount || 0) > 0 && (
            <div className="flex justify-between text-sm text-danger-600">
              <span>Discount</span>
              <span>-{fmt(cartDiscount)}</span>
            </div>
          )}
          {taxRate > 0 && (
            <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
              <span>Tax ({taxRate}%)</span>
              <span>{fmt(taxAmount)}</span>
            </div>
          )}

          {/* Total */}
          <div className="flex justify-between items-center pt-2 border-t border-gray-100 dark:border-gray-800">
            <span className="text-base font-bold text-gray-900 dark:text-gray-100">Total</span>
            <span className="text-2xl font-bold text-primary-600">{fmt(total)}</span>
          </div>

          {/* Charge button */}
          <Button
            variant="success"
            size="lg"
            className="w-full text-base"
            disabled={items.length === 0}
            onClick={() => setShowPaymentModal(true)}
            title="Charge (F2)"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            Charge {items.length > 0 && fmt(total)} <span className="ml-1 text-xs opacity-75">(F2)</span>
          </Button>
        </div>
      </div>

      {/* ── Modals ── */}
      {/* Mounted only while open so each payment starts with fresh state */}
      {showPaymentModal && (
      <PaymentModal
        isOpen
        onClose={() => setShowPaymentModal(false)}
        total={total}
        onConfirm={handlePaymentConfirm}
        isLoading={isSubmitting}
        selectedCustomer={customer}
      />
      )}

      <Modal
        isOpen={showReceiptModal}
        onClose={closeReceipt}
        title="Sale Complete — Receipt"
        size="md"
      >
        <Receipt sale={completedSale} onClose={closeReceipt} />
      </Modal>

      <CustomerModal
        isOpen={showCustomerModal}
        onClose={() => setShowCustomerModal(false)}
        onSelect={setCustomer}
      />

      {/* Clear cart confirmation */}
      <Modal
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        title="Clear Cart"
        size="sm"
      >
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Are you sure you want to clear all items from the cart? This cannot be undone.</p>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setShowClearConfirm(false)}>Cancel</Button>
          <Button
            variant="danger"
            className="flex-1"
            onClick={() => { clearCart(); setShowClearConfirm(false); toast.success('Cart cleared'); searchRef.current?.focus() }}
            title="Enter"
            autoFocus
          >
            Clear Cart (Enter)
          </Button>
        </div>
      </Modal>
    </div>
    </DashboardLayout>
  )
}
