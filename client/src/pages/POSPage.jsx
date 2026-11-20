import { useState, useEffect, useRef, useCallback } from 'react'
import toast from 'react-hot-toast'
import { useCart } from '../context/CartContext'
import { productsService } from '../services/products'
import { salesService } from '../services/sales'
import { customersService } from '../services/customers'
import { shiftsService } from '../services/shifts'
import { promotionsService } from '../services/promotions'
import { OpenShiftModal, CloseShiftModal } from '../components/ShiftModals'
import { formatCurrency } from '../utils/formatCurrency'
import { lineTotal, round2, calculateTotals, maxRedeemablePoints, applyPromotions, bestPromotion } from '../utils/saleTotals'
import { splitCash } from '../utils/payments'
import { isNetworkError, newClientRef, queueSale, queuedSales, removeQueued, syncQueuedSales } from '../utils/offlineQueue'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Modal } from '../components/Modal'
import { Badge } from '../components/Badge'
import { Receipt } from '../components/Receipt'
import { useAuth } from '../hooks/useAuth'
import { useBranch } from '../hooks/useBranch'
import { BranchSwitcher } from '../components/BranchSwitcher'
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

function PaymentModal({ isOpen, onClose, total, onConfirm, isLoading, selectedCustomer, onBeforeCharge }) {
  const { currency_symbol, store_name } = useSettings()
  const sym = currency_symbol || 'GH₵'
  const fmt = (v) => formatCurrency(v, sym)

  const [method, setMethod] = useState('CASH')
  const [amountPaid, setAmountPaid] = useState('')
  // Split payments: the part charged by card or Mobile Money; cash (amountPaid) covers the rest
  const [splitMethod, setSplitMethod] = useState('MOBILE_MONEY')
  const [splitAmount, setSplitAmount] = useState('')
  const [errors, setErrors] = useState({})
  const [isChecking, setIsChecking] = useState(false)
  // A Paystack charge that succeeded; kept so a failed sale is retried without charging again
  const [paidCharge, setPaidCharge] = useState(null)

  const paid = parseFloat(amountPaid)
  const change = method === 'CASH' && paid >= total ? paid - total : 0
  const split = method === 'SPLIT' ? splitCash(total, splitAmount, amountPaid) : null

  function validate() {
    const errs = {}
    if (method === 'CASH' && (isNaN(paid) || paid < total)) {
      errs.amountPaid = `Amount must be at least ${fmt(total)}`
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  // What to send for a charge Paystack has taken (and, for a split, the cash handed over)
  function chargePayload(charge) {
    return charge.split
      ? {
          payment_method: 'SPLIT',
          payments: [
            { method: 'CASH', amount: charge.split.cash },
            { method: charge.method, amount: charge.total, reference: charge.reference },
          ],
          reference: charge.reference,
        }
      : { payment_method: charge.method, amount_paid: charge.total, reference: charge.reference }
  }

  async function handleConfirm() {
    if (isLoading || isChecking) return
    if (method === 'CASH') {
      if (!validate()) return
      onConfirm({ payment_method: 'CASH', amount_paid: paid })
      return
    }

    if (paidCharge) {
      onConfirm(chargePayload(paidCharge))
      return
    }

    let chargeMethod = method
    let amount = total
    let splitInfo = null
    if (method === 'SPLIT') {
      if (split.error) {
        setErrors({ split: split.error })
        return
      }
      chargeMethod = splitMethod
      amount = round2(parseFloat(splitAmount))
      splitInfo = { cash: round2(paid) }
    }

    // CARD or MOBILE_MONEY (all of it, or its part of a split) — open Paystack popup
    const publicKey = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY
    if (!window.PaystackPop || !publicKey) {
      toast.error('Card and Mobile Money payments are not configured. Add VITE_PAYSTACK_PUBLIC_KEY to client/.env')
      return
    }
    // The server re-prices the sale and rejects a charge that doesn't match, so confirm the total first
    setIsChecking(true)
    const totalIsCurrent = await onBeforeCharge()
    setIsChecking(false)
    if (!totalIsCurrent) return
    const handler = window.PaystackPop.setup({
      key: publicKey,
      email: selectedCustomer?.email || 'guest@quickmart.com',
      amount: Math.round(amount * 100), // Paystack uses pesewas; must equal what the server expects for this part
      currency: 'GHS',
      ref: 'QM-' + Date.now() + '-' + Math.floor(Math.random() * 1000000),
      channels: chargeMethod === 'CARD' ? ['card'] : ['mobile_money'],
      metadata: {
        custom_fields: [{ display_name: 'Store', variable_name: 'store', value: store_name || 'QuickMart' }],
      },
      onClose: () => {
        toast.error('Payment was cancelled')
      },
      callback: (response) => {
        const charge = { method: chargeMethod, total: amount, reference: response.reference, split: splitInfo }
        setPaidCharge(charge)
        onConfirm(chargePayload(charge))
      },
    })
    handler.openIframe()
  }

  function handleClose() {
    if (paidCharge) {
      toast.error(
        `The customer paid ${fmt(paidCharge.total)} (Paystack ref ${paidCharge.reference}) but the sale was not saved. Refund it from Paystack or ring it up again.`,
        { duration: Infinity }
      )
    }
    onClose()
  }

  const methods = [
    { value: 'CASH', label: 'Cash' },
    { value: 'MOBILE_MONEY', label: 'Mobile Money' },
    { value: 'CARD', label: 'Card' },
    { value: 'SPLIT', label: 'Split' },
  ]

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Process Payment" size="sm">
      {/* Enter confirms card and mobile money too (cash confirms from its amount box), except on Cancel */}
      <div
        className="space-y-4"
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || method === 'CASH' || e.target.closest('[data-cancel]')) return
          e.preventDefault()
          handleConfirm()
        }}
      >
        {/* Total */}
        <div className="bg-primary-50 border border-primary-100 rounded-lg p-4 text-center">
          <p className="text-sm text-primary-600 font-medium">Amount Due</p>
          <p className="text-3xl font-bold text-primary-700 mt-1">{fmt(total)}</p>
        </div>

        {/* Payment Method */}
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Payment Method</p>
          <div className="grid grid-cols-2 gap-2">
            {methods.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => { setMethod(m.value); setErrors({}) }}
                disabled={Boolean(paidCharge)}
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

        {/* Split: part by card or Mobile Money (through Paystack), the rest in cash */}
        {method === 'SPLIT' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="split-method" className="text-sm font-medium text-gray-700 dark:text-gray-300">Part paid by</label>
                <select
                  id="split-method"
                  value={splitMethod}
                  onChange={(e) => setSplitMethod(e.target.value)}
                  disabled={Boolean(paidCharge)}
                  className="block w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="MOBILE_MONEY">Mobile Money</option>
                  <option value="CARD">Card</option>
                </select>
              </div>
              <Input
                label={`Amount (${sym})`}
                type="number"
                min="0.01"
                step="0.01"
                value={splitAmount}
                onChange={(e) => { setSplitAmount(e.target.value); setErrors({}) }}
                disabled={Boolean(paidCharge)}
                autoFocus
              />
            </div>
            <Input
              label={`Cash received (${sym})`}
              type="number"
              min="0"
              step="0.01"
              value={amountPaid}
              onChange={(e) => { setAmountPaid(e.target.value); setErrors({}) }}
              disabled={Boolean(paidCharge)}
              placeholder={split?.due > 0 ? split.due.toFixed(2) : ''}
            />
            {split?.due > 0 && (
              <div className="flex justify-between items-center rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 px-3 py-2 text-sm">
                <span className="text-gray-600 dark:text-gray-300">Cash due {fmt(split.due)}</span>
                {split.change !== undefined && <span className="font-bold text-success-700">Change {fmt(split.change)}</span>}
              </div>
            )}
            {errors.split && <p className="text-xs text-danger-600 dark:text-danger-400">{errors.split}</p>}
          </div>
        )}

        {paidCharge && (
          <div className="rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-600">
            Payment of {fmt(paidCharge.total)} received (ref {paidCharge.reference}), but the sale was not saved.
            Press Confirm to try saving it again. The customer will not be charged twice.
          </div>
        )}

        {/* Card / Mobile Money: Paystack handles payment details in its popup */}
        {!paidCharge && (method === 'MOBILE_MONEY' || method === 'CARD') && (
          <div className="rounded-lg border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-primary-700">
            A secure Paystack payment window will open to complete this transaction.
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" className="flex-1" onClick={handleClose} disabled={isLoading} data-cancel>Cancel</Button>
          <Button variant="success" className="flex-1" onClick={handleConfirm} isLoading={isLoading || isChecking} title="Enter">
            Confirm Payment
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Variant Picker ────────────────────────────────────────────────────────────
// A product with sizes or flavours: the main product and each active variant are separate options
function VariantPicker({ product, onClose, onPick, fmt }) {
  const options = product ? [product, ...(product.variants || [])] : []
  return (
    <Modal isOpen={Boolean(product)} onClose={onClose} title={product ? `Choose ${product.name}` : ''} size="sm">
      <div className="grid grid-cols-2 gap-2">
        {options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onPick(option)}
            disabled={option.quantity === 0}
            autoFocus={index === 0}
            className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-left transition hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{option.variant_name || option.name}</p>
            <p className="text-xs text-gray-400 truncate">{option.sku}</p>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-sm font-bold text-primary-600">{fmt(option.price)}</span>
              <span className={`text-xs ${option.quantity === 0 ? 'text-danger-600' : 'text-gray-500 dark:text-gray-400'}`}>
                {option.quantity === 0 ? 'Out' : `${option.quantity} left`}
              </span>
            </div>
          </button>
        ))}
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
    if (!query.trim()) { setResults([]); setIsLoading(false); return }
    // Drop responses for an older query or a closed modal so the wrong customer can't be picked
    let cancelled = false
    const id = setTimeout(async () => {
      setIsLoading(true)
      try {
        const res = await customersService.list({ search: query, per_page: 10 })
        if (!cancelled) setResults(res.data?.data || [])
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(id) }
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
  // The cashier's discount comes off what is left after any promotion
  const lineGross = round2(round2(parseFloat(item.price) * item.quantity) - (item.promotion_discount || 0))
  const clampQty = (q) => Math.min(Math.max(q, 1), item.quantity_available)
  // What the cashier is typing; lets the box be cleared and retyped without snapping back to 1
  const [qtyDraft, setQtyDraft] = useState(null)
  return (
    <div className="py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{item.name}</p>
          <p className="text-xs text-gray-400">{fmt(item.price)} each · {item.quantity_available} in stock</p>
          {item.promotion && (
            <p className="text-xs font-medium text-success-600 dark:text-success-400 truncate">
              {item.promotion.name} · {Number(item.promotion.percent_off)}% off · -{fmt(item.promotion_discount)}
            </p>
          )}
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
            value={qtyDraft ?? item.quantity}
            onChange={(e) => {
              setQtyDraft(e.target.value)
              const q = parseInt(e.target.value)
              if (q > 0) onUpdate(item.product_id, clampQty(q))
            }}
            onBlur={() => setQtyDraft(null)}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
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
          {fmt(lineTotal(item.price, item.quantity, item.line_discount ?? item.discount))}
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
  const { branchId, isAllBranches } = useBranch()
  const { loyalty_points_rate, currency_symbol, refreshSettings, require_open_shift } = useSettings()
  const fmt = (v) => formatCurrency(v, currency_symbol || 'GH₵')
  const { items, cartDiscount, customer, redeemPoints, maxPoints, pointValue, pointsDiscount, subtotal, taxAmount, taxRate, total, addItem, removeItem, updateQuantity, updateDiscount, setCartDiscount, setCustomer, setRedeemPoints, clearCart, syncItems, promotions, setPromotions } = useCart()

  const [searchQuery, setSearchQuery] = useState('')
  const [products, setProducts] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [categories, setCategories] = useState([])
  const [activeCategory, setActiveCategory] = useState('')
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  // Cash sales saved on this device while the server couldn't be reached
  const [offlineSales, setOfflineSales] = useState([])
  const isSyncing = useRef(false)
  // The product whose sizes or flavours are being offered, or null
  const [choosingVariant, setChoosingVariant] = useState(null)
  const [showReceiptModal, setShowReceiptModal] = useState(false)
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [completedSale, setCompletedSale] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // undefined while loading, null when no shift is open
  const [currentShift, setCurrentShift] = useState(undefined)
  const [showOpenShift, setShowOpenShift] = useState(false)
  const [closingShift, setClosingShift] = useState(null)

  const searchRef = useRef(null)
  const barcodeBufferRef = useRef('')
  const barcodeTimerRef = useRef(null)
  // Latest cart items, readable from long-lived event listeners without stale closures
  const itemsRef = useRef(items)
  itemsRef.current = items

  const anyModalOpen = showPaymentModal || showReceiptModal || showCustomerModal || showClearConfirm || showOpenShift || Boolean(closingShift)
  // An admin's open shift may be at another branch; sales here can't go into that drawer
  const shiftElsewhere = Boolean(currentShift && branchId && currentShift.branch_id !== branchId)
  // When the store requires it, nothing can be charged until a shift is open here
  const needsShift = require_open_shift === 'true' && (currentShift === null || shiftElsewhere)
  const canCharge = items.length > 0 && !needsShift && currentShift !== undefined

  const loadShift = useCallback(() => {
    return shiftsService.current()
      .then((res) => { setCurrentShift(res.data?.data ?? null); return res.data?.data ?? null })
      .catch(() => { setCurrentShift(null); return null })
  }, [])

  useEffect(() => {
    loadShift()
  }, [loadShift])

  async function startCloseShift() {
    // Their cash is in this drawer, so they must reach the server before the count
    if (offlineSales.some((e) => !e.error)) {
      toast.error('Send the sales saved offline before closing the shift')
      return
    }
    // Fresh totals, so the expected cash includes every sale up to now
    const shift = await loadShift()
    if (shift) setClosingShift(shift)
  }

  // Focus search on mount, and pick up any tax/loyalty changes an admin made since login
  useEffect(() => {
    searchRef.current?.focus()
    refreshSettings()
  }, [refreshSettings])

  // Running promotions are applied to the cart automatically, as the server applies them
  useEffect(() => {
    promotionsService.active()
      .then((res) => setPromotions(res.data?.data || []))
      .catch(() => {}) // without them the server's total differs, which the pre-charge check reports
  }, [setPromotions])

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
        let notStocked = false
        const res = await productsService.byBarcode(q).catch((err) => {
          notStocked = err?.response?.data?.error?.message === 'Not stocked at this branch'
          return null
        })
        if (notStocked) {
          toast.error('This product is not stocked at this branch')
          return false
        }
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
      if (!['F1', 'F2', 'F4'].includes(e.key)) return
      e.preventDefault()
      // Includes dialogs this page doesn't own, such as the sign-out confirmation
      const dialogOpen = anyModalOpen || Boolean(document.querySelector('[role="dialog"]'))
      if (dialogOpen) return
      if (e.key === 'F1') searchRef.current?.focus()
      if (e.key === 'F2' && canCharge) setShowPaymentModal(true)
      if (e.key === 'F4' && items.length > 0) setShowClearConfirm(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [items.length, anyModalOpen, canCharge])

  // Barcode scanner detection when focus is outside any input: rapid keystrokes ending with Enter.
  // (When the search box is focused, its own Enter handler resolves the code.)
  // Registered once; current state is read through refs so the buffer's reset timer survives re-renders.
  const addByCodeRef = useRef(addByCode)
  addByCodeRef.current = addByCode
  const scanBlockedRef = useRef(false)
  // A scan may start the next sale while the receipt is still showing; other dialogs block scans
  scanBlockedRef.current = showPaymentModal || showCustomerModal || showClearConfirm || showOpenShift || Boolean(closingShift)
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
    // A superseded request must not overwrite the grid or clear the spinner for the newer one
    let cancelled = false
    setIsSearching(true)
    const id = setTimeout(async () => {
      try {
        const params = { per_page: query ? 20 : 40 }
        // Browsing shows one card per product with its variants; a search finds each variant directly
        if (query) params.search = query
        else params.group_variants = true
        if (activeCategory) params.category_id = activeCategory
        const res = await productsService.list(params)
        if (!cancelled) setProducts(res.data?.data || [])
      } catch {
        if (!cancelled) setProducts([])
      } finally {
        if (!cancelled) setIsSearching(false)
      }
    }, query ? 300 : 0)
    return () => { cancelled = true; clearTimeout(id) }
  }, [searchQuery, activeCategory])

  function handleAddProduct(product) {
    if (product.variants?.length > 0) {
      setChoosingVariant(product)
      return
    }
    tryAddProduct(product)
    setSearchQuery('')
    searchRef.current?.focus()
  }

  function handlePickVariant(option) {
    setChoosingVariant(null)
    tryAddProduct(option)
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

  // Re-fetches cart prices, stock, and the tax rate. Returns true only if the total shown is still
  // what the server will charge; otherwise the cart is updated so the cashier sees the new total.
  async function checkCartBeforeCharge() {
    try {
      const [products, latestSettings, latestPromotions] = await Promise.all([
        Promise.all(items.map((i) => productsService.get(i.product_id).then((res) => res.data.data))),
        refreshSettings(),
        promotionsService.active().then((res) => res.data?.data || []),
      ])
      if (!latestSettings) throw new Error('Settings unavailable')
      const updates = Object.fromEntries(products.map((p) => [p.id, { price: p.price, quantity_available: p.quantity, category_id: p.category_id }]))
      const refreshed = applyPromotions(items.map((i) => ({ ...i, ...updates[i.product_id] })), latestPromotions)
      syncItems(updates)
      setPromotions(latestPromotions)

      const shortItem = refreshed.find((i) => i.quantity > i.quantity_available)
      if (shortItem) {
        toast.error(`Only ${shortItem.quantity_available} ${shortItem.name} left in stock — update the cart`)
        return false
      }
      // Points are re-valued at the latest point value, capped the same way the cart caps them
      const latestPointValue = parseFloat(latestSettings.loyalty_point_value) || 0
      const refreshedSubtotal = calculateTotals(refreshed, 0, 0).subtotal
      const latestPoints = Math.min(
        redeemPoints,
        maxRedeemablePoints(refreshedSubtotal, Math.min(cartDiscount || 0, refreshedSubtotal), customer?.loyalty_points, latestPointValue)
      )
      const latest = calculateTotals(refreshed, cartDiscount, parseFloat(latestSettings.tax_rate) || 0, round2(latestPoints * latestPointValue))
      if (latest.total !== total) {
        toast.error(`Prices, promotions or tax changed. The new total is ${formatCurrency(latest.total, currency_symbol)} — confirm again to charge it`)
        return false
      }
      return true
    } catch {
      toast.error('Could not confirm the current prices. Check the connection and try again.')
      return false
    }
  }

  // Sends sales queued offline; runs when the till opens and whenever the connection comes back
  const syncOffline = useCallback(async () => {
    // One run at a time, or the same sales would be sent (and counted) twice
    if (!user?.id || isSyncing.current) return
    isSyncing.current = true
    try {
      if (queuedSales(user.id).some((e) => !e.error)) {
        const { synced, refused } = await syncQueuedSales(user.id, (payload, saleBranch) => salesService.create(payload, saleBranch))
        if (synced) toast.success(`${synced} sale${synced === 1 ? '' : 's'} saved offline sent to the server`)
        if (refused) toast.error(`${refused} offline sale${refused === 1 ? ' was' : 's were'} refused; see the note above the products`, { duration: 8000 })
      }
    } finally {
      isSyncing.current = false
      setOfflineSales(queuedSales(user.id))
    }
  }, [user?.id])

  // Also retry every minute: the server can be down while the device still has a connection
  useEffect(() => {
    syncOffline()
    window.addEventListener('online', syncOffline)
    const timer = setInterval(() => {
      if (user?.id && queuedSales(user.id).some((e) => !e.error)) syncOffline()
    }, 60000)
    return () => { window.removeEventListener('online', syncOffline); clearInterval(timer) }
  }, [syncOffline, user?.id])

  async function handlePaymentConfirm({ payment_method, amount_paid, reference, payments }) {
    // One id per sale, so a resend (e.g. from the offline queue) is never recorded twice
    const client_ref = newClientRef()
    setIsSubmitting(true)
    let payload
    try {
      payload = {
        client_ref,
        items: items.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          discount: i.discount || 0,
        })),
        customer_id: customer?.id || null,
        payment_method,
        // A split payment sends its parts instead of one amount
        ...(payments ? { payments } : { amount_paid }),
        discount_amount: cartDiscount || 0,
        ...(customer && redeemPoints > 0 ? { redeem_points: redeemPoints } : {}),
        ...(reference && !payments ? { reference } : {}),
      }
      const res = await salesService.create(payload)
      const sale = res.data?.data
      setCompletedSale(sale)
      setShowPaymentModal(false)
      setShowReceiptModal(true)
      clearCart()
      // Reflect the sold quantities in the visible grid
      const afterSale = (p) => {
        const sold = sale.items?.find((i) => i.product_id === p.id)
        return sold ? { ...p, quantity: p.quantity - sold.quantity } : p
      }
      setProducts((prev) => prev.map((p) => ({ ...afterSale(p), ...(p.variants && { variants: p.variants.map(afterSale) }) })))

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
      // No connection: keep a cash sale on this device and send it later. Card and Mobile Money
      // need Paystack, so they can't be taken offline
      // Points can't be checked offline, so a sale spending them must wait for the connection
      if (isNetworkError(err) && payment_method === 'CASH' && payload && !payload.redeem_points) {
        queueSale(user.id, payload, total, branchId)
        setOfflineSales(queuedSales(user.id))
        setShowPaymentModal(false)
        clearCart()
        toast.success(`No connection. Sale saved on this device; give change of ${formatCurrency(Math.max(0, amount_paid - total), currency_symbol)}. It is sent when the connection is back.`, { duration: 8000 })
        return
      }
      const apiError = err.response?.data?.error
      toast.error(apiError?.details?.[0]?.message || apiError?.message || 'Failed to process sale')
      // The shift may have been closed elsewhere (e.g. by a manager); show the real state
      if (apiError?.details?.[0]?.field === 'shift') {
        setShowPaymentModal(false)
        loadShift()
      }
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

  if (isAllBranches) {
    return (
      <DashboardLayout>
        <div className="max-w-md mx-auto mt-16 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center space-y-4">
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">Choose a branch to sell</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Each branch sells from its own stock and its own cash drawer. Pick the branch you are working at.
          </p>
          <BranchSwitcher className="justify-center" />
        </div>
      </DashboardLayout>
    )
  }

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
            {offlineSales.length > 0 && (
              <div className="mt-1 space-y-0.5 text-xs">
                {offlineSales.some((e) => !e.error) && (
                  <p className="text-warning-600">
                    {offlineSales.filter((e) => !e.error).length} sale(s) saved offline, waiting to be sent.{' '}
                    <button type="button" onClick={syncOffline} className="font-semibold underline">Send now</button>
                  </p>
                )}
                {offlineSales.filter((e) => e.error).map((e) => (
                  <p key={e.id} className="text-danger-600">
                    Offline sale of {formatCurrency(e.total, currency_symbol)} ({new Date(e.queued_at).toLocaleTimeString('en-GH')}) was refused: {e.error}. Ring it up again or refund the customer.{' '}
                    <button type="button" onClick={() => { removeQueued(e.id); setOfflineSales(queuedSales(user.id)) }} className="font-semibold underline">Dismiss</button>
                  </p>
                ))}
              </div>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Cashier</p>
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{user?.full_name || '—'}</p>
            {currentShift && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {shiftElsewhere ? `Shift at ${currentShift.branch?.name ?? 'another branch'} since` : 'Shift since'} {new Date(currentShift.opened_at).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}
                {' · '}
                <button type="button" onClick={startCloseShift} className="text-primary-600 dark:text-primary-400 hover:underline font-medium">
                  Close shift
                </button>
              </p>
            )}
            {currentShift === null && !needsShift && (
              <button type="button" onClick={() => setShowOpenShift(true)} className="text-xs text-primary-600 dark:text-primary-400 hover:underline font-medium">
                Open shift
              </button>
            )}
          </div>
        </div>

        {needsShift && !shiftElsewhere && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-warning-100 bg-warning-50 dark:bg-warning-900/20 px-4 py-3">
            <p className="text-sm text-warning-700 dark:text-warning-400">Open a shift and count your opening float before you start selling.</p>
            <Button size="sm" onClick={() => setShowOpenShift(true)}>Open shift</Button>
          </div>
        )}
        {needsShift && shiftElsewhere && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-warning-100 bg-warning-50 dark:bg-warning-900/20 px-4 py-3">
            <p className="text-sm text-warning-700 dark:text-warning-400">
              Your open shift is at {currentShift.branch?.name ?? 'another branch'}. Close it before selling at this branch.
            </p>
            <Button size="sm" onClick={startCloseShift}>Close shift</Button>
          </div>
        )}

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
                  disabled={product.variants?.length > 0 ? [product, ...product.variants].every((o) => o.quantity === 0) : product.quantity === 0}
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
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1 flex items-center gap-1.5">
                    <span className="truncate">{product.sku}</span>
                    {(() => {
                      const promo = bestPromotion({ product_id: product.id, category_id: product.category_id }, promotions)
                      return promo && (
                        <span className="flex-shrink-0 rounded bg-success-100 dark:bg-success-900/30 px-1 font-semibold text-success-700 dark:text-success-400" title={promo.name}>
                          -{Number(promo.percent_off)}%
                        </span>
                      )
                    })()}
                  </p>
                  {product.variants?.length > 0 ? (
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-sm font-bold text-primary-600">
                        from {fmt(Math.min(...[product, ...product.variants].map((o) => Number(o.price))))}
                      </span>
                      <Badge variant="primary">{product.variants.length + 1} options</Badge>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-sm font-bold text-primary-600">{fmt(product.price)}</span>
                      <Badge variant={product.quantity === 0 ? 'danger' : product.quantity <= product.low_stock_threshold ? 'warning' : 'success'}>
                        {product.quantity === 0 ? 'Out' : `${product.quantity}`}
                      </Badge>
                    </div>
                  )}
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

          {/* Loyalty points redemption, when the store has turned it on */}
          {customer && pointValue > 0 && (customer.loyalty_points ?? 0) > 0 && (
            <div className="flex items-center gap-3">
              <label htmlFor="redeem-points" className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">Use Points</label>
              <input
                id="redeem-points"
                type="number"
                min={0}
                max={maxPoints}
                step="1"
                value={redeemPoints || ''}
                onChange={(e) => setRedeemPoints(Math.min(parseInt(e.target.value, 10) || 0, maxPoints))}
                placeholder="0"
                disabled={maxPoints === 0}
                className="flex-1 min-w-0 text-right border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg py-1.5 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setRedeemPoints(redeemPoints === maxPoints ? 0 : maxPoints)}
                disabled={maxPoints === 0}
                title={`Each point is worth ${fmt(pointValue)}`}
                className="text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline disabled:opacity-50 disabled:no-underline whitespace-nowrap"
              >
                {redeemPoints > 0 && redeemPoints === maxPoints ? 'None' : `Max (${maxPoints})`}
              </button>
            </div>
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
          {pointsDiscount > 0 && (
            <div className="flex justify-between text-sm text-danger-600">
              <span>Points ({redeemPoints} pts)</span>
              <span>-{fmt(pointsDiscount)}</span>
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
            disabled={!canCharge}
            onClick={() => setShowPaymentModal(true)}
            title={needsShift ? 'Open a shift first' : 'Charge (F2)'}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            Charge {items.length > 0 && fmt(total)} <span className="ml-1 text-xs opacity-75">(F2)</span>
          </Button>
        </div>
      </div>

      {/* ── Modals ── */}
      <OpenShiftModal
        isOpen={showOpenShift}
        onClose={() => setShowOpenShift(false)}
        onOpened={(shift) => { setCurrentShift(shift); setShowOpenShift(false); searchRef.current?.focus() }}
      />
      {closingShift && (
        <CloseShiftModal
          shift={closingShift}
          onClose={() => { setClosingShift(null); searchRef.current?.focus() }}
          onClosed={() => setCurrentShift(null)}
        />
      )}
      <VariantPicker
        product={choosingVariant}
        onClose={() => { setChoosingVariant(null); searchRef.current?.focus() }}
        onPick={handlePickVariant}
        fmt={fmt}
      />

      {/* Mounted only while open so each payment starts with fresh state */}
      {showPaymentModal && (
      <PaymentModal
        isOpen
        onClose={() => setShowPaymentModal(false)}
        total={total}
        onConfirm={handlePaymentConfirm}
        onBeforeCharge={checkCartBeforeCharge}
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
