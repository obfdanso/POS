import { useState, useEffect, useRef, useCallback } from 'react'
import toast from 'react-hot-toast'
import { useCart } from '../context/CartContext'
import { productsService } from '../services/products'
import { salesService } from '../services/sales'
import { customersService } from '../services/customers'
import { formatCurrency } from '../utils/formatCurrency'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Modal } from '../components/Modal'
import { Badge } from '../components/Badge'
import { useAuth } from '../hooks/useAuth'
import { useSettings } from '../context/SettingsContext'
import { DashboardLayout } from '../layouts/DashboardLayout'

// ─── Receipt Component (rendered inside a modal, printable) ───────────────────
function Receipt({ sale, onClose }) {
  const settings = useSettings()
  const sym = settings.currency_symbol || 'GH₵'
  const fmt = (v) => formatCurrency(v, sym)

  function handlePrint() {
    const sym = settings.currency_symbol || 'GH₵'
    function fmt(v) {
      const num = parseFloat(v)
      if (isNaN(num)) return `${sym} 0.00`
      return `${sym} ${num.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }

    const itemsHTML = (items || []).map((item) => `
      <tr>
        <td style="text-align:left;padding:2px 0;">${item.product?.name || item.name || ''}</td>
        <td style="text-align:center;padding:2px 4px;">${item.quantity}</td>
        <td style="text-align:right;padding:2px 4px;">${fmt(item.unit_price)}</td>
        <td style="text-align:right;padding:2px 0;">${fmt(item.total)}</td>
      </tr>`).join('')

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt ${transaction_id}</title>
  <style>
    body { font-family: monospace; font-size: 12px; width: 80mm; margin: 0 auto; padding: 8px; color: #000; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; }
    .center { text-align: center; }
    .right { text-align: right; }
    .bold { font-weight: bold; }
    .dashed { border-top: 1px dashed #000; margin: 6px 0; }
    .row { display: flex; justify-content: space-between; margin: 2px 0; }
  </style>
</head>
<body>
  <div class="center">
    <div class="bold" style="font-size:14px;">${settings.store_name || 'QuickMart'}</div>
    ${settings.store_address ? `<div>${settings.store_address}</div>` : ''}
    ${settings.store_phone ? `<div>Tel: ${settings.store_phone}</div>` : ''}
  </div>
  <div class="dashed"></div>
  <div class="row"><span>TXN:</span><span>${transaction_id}</span></div>
  <div class="row"><span>Date:</span><span>${new Date(created_at).toLocaleString('en-GH')}</span></div>
  <div class="row"><span>Cashier:</span><span>${user?.full_name || '—'}</span></div>
  ${customer ? `<div class="row"><span>Customer:</span><span>${customer.name}</span></div>` : ''}
  <div class="dashed"></div>
  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th style="text-align:center;">Qty</th>
        <th style="text-align:right;">Price</th>
        <th style="text-align:right;">Total</th>
      </tr>
    </thead>
    <tbody>${itemsHTML}</tbody>
  </table>
  <div class="dashed"></div>
  <div class="row"><span>Subtotal:</span><span>${fmt(subtotal)}</span></div>
  ${parseFloat(discount_amount) > 0 ? `<div class="row"><span>Discount:</span><span>-${fmt(discount_amount)}</span></div>` : ''}
  ${parseFloat(tax_amount) > 0 ? `<div class="row"><span>Tax:</span><span>${fmt(tax_amount)}</span></div>` : ''}
  <div class="dashed"></div>
  <div class="row bold" style="font-size:14px;"><span>TOTAL:</span><span>${fmt(total_amount)}</span></div>
  <div class="row"><span>Payment:</span><span>${payment_method}</span></div>
  ${payment?.amount_paid ? `<div class="row"><span>Amount Paid:</span><span>${fmt(payment.amount_paid)}</span></div>` : ''}
  ${parseFloat(payment?.change_given) > 0 ? `<div class="row"><span>Change:</span><span>${fmt(payment.change_given)}</span></div>` : ''}
  ${payment?.reference ? `<div class="row"><span>Reference:</span><span>${payment.reference}</span></div>` : ''}
  <div class="dashed"></div>
  <div class="center">${settings.receipt_footer || 'Thank you for choosing QuickMart!'}</div>
</body>
</html>`

    const win = window.open('', '_blank', `width=${screen.availWidth},height=${screen.availHeight},left=0,top=0`)
    win.document.write(html)
    win.document.close()
    win.focus()
    win.print()
    win.addEventListener('afterprint', () => win.close())
  }

  if (!sale) return null

  const { transaction_id, created_at, user, customer, sale_items: items, subtotal, discount_amount, tax_amount, total_amount, payment_method, payments } = sale
  const payment = payments?.[0]

  return (
    <>
      {/* Print styles injected inline so they scope to .receipt-root */}
      <style>{`
        @media print {
          body > * { display: none !important; }
          .receipt-print-wrapper { display: block !important; position: fixed; inset: 0; z-index: 9999; background: white; }
          .receipt-root { width: 80mm; margin: 0 auto; font-family: monospace; font-size: 12px; }
          .receipt-no-print { display: none !important; }
        }
        .receipt-print-wrapper { display: none; }
        .receipt-root { background-color: white !important; color: #111827 !important; }
        .receipt-root, .receipt-root p, .receipt-root span, .receipt-root div { color: #111827 !important; border-color: #9ca3af !important; }
      `}</style>

      {/* Screen receipt inside modal */}
      <div className="receipt-root font-mono text-sm text-gray-900">
        <div className="text-center mb-3">
          <p className="font-bold text-base">{settings.store_name || 'QuickMart'}</p>
          {settings.store_address && <p className="text-xs text-gray-500">{settings.store_address}</p>}
          {settings.store_phone && <p className="text-xs text-gray-500">Tel: {settings.store_phone}</p>}
        </div>

        <div className="border-t border-dashed border-gray-400 pt-2 mb-2 text-xs">
          <div className="flex justify-between"><span>TXN:</span><span className="font-semibold">{transaction_id}</span></div>
          <div className="flex justify-between"><span>Date:</span><span>{new Date(created_at).toLocaleString('en-GH')}</span></div>
          <div className="flex justify-between"><span>Cashier:</span><span>{user?.full_name || '—'}</span></div>
          {customer && <div className="flex justify-between"><span>Customer:</span><span>{customer.name}</span></div>}
        </div>

        <div className="border-t border-dashed border-gray-400 py-2 text-xs">
          <div className="flex justify-between font-semibold mb-1">
            <span className="w-2/5">Item</span>
            <span className="w-1/5 text-right">Qty</span>
            <span className="w-1/5 text-right">Price</span>
            <span className="w-1/5 text-right">Total</span>
          </div>
          {(items || []).map((item, i) => (
            <div key={i} className="flex justify-between py-0.5">
              <span className="w-2/5 truncate">{item.product?.name || item.name}</span>
              <span className="w-1/5 text-right">{item.quantity}</span>
              <span className="w-1/5 text-right">{formatCurrency(item.unit_price)}</span>
              <span className="w-1/5 text-right">{formatCurrency(item.total)}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-dashed border-gray-400 pt-2 text-xs space-y-1">
          <div className="flex justify-between"><span>Subtotal:</span><span>{formatCurrency(subtotal)}</span></div>
          {parseFloat(discount_amount) > 0 && (
            <div className="flex justify-between text-danger-600"><span>Discount:</span><span>-{formatCurrency(discount_amount)}</span></div>
          )}
          {parseFloat(tax_amount) > 0 && (
            <div className="flex justify-between"><span>Tax:</span><span>{formatCurrency(tax_amount)}</span></div>
          )}
          <div className="flex justify-between font-bold text-base border-t border-gray-300 pt-1 mt-1">
            <span>TOTAL:</span><span>{formatCurrency(total_amount)}</span>
          </div>
          <div className="flex justify-between"><span>Payment:</span><span>{payment_method}</span></div>
          {payment && (
            <>
              <div className="flex justify-between"><span>Amount Paid:</span><span>{formatCurrency(payment.amount_paid)}</span></div>
              {parseFloat(payment.change_given) > 0 && (
                <div className="flex justify-between font-semibold"><span>Change:</span><span>{formatCurrency(payment.change_given)}</span></div>
              )}
              {payment.reference && (
                <div className="flex justify-between"><span>Reference:</span><span>{payment.reference}</span></div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-dashed border-gray-400 mt-3 pt-2 text-center text-xs text-gray-500">
          <p>{settings.receipt_footer || 'Thank you for choosing QuickMart!'}</p>
        </div>
      </div>

      {/* Hidden printable duplicate (positioned off-screen during normal view) */}
      <div className="receipt-print-wrapper">
        <div className="receipt-root font-mono text-sm text-gray-900 p-4">
          <div className="text-center mb-3">
            <p className="font-bold text-base">{settings.store_name || 'QuickMart'}</p>
            {settings.store_address && <p className="text-xs">{settings.store_address}</p>}
            {settings.store_phone && <p className="text-xs">Tel: {settings.store_phone}</p>}
          </div>
          <div className="border-t border-dashed pt-2 mb-2 text-xs">
            <div className="flex justify-between"><span>TXN:</span><span>{transaction_id}</span></div>
            <div className="flex justify-between"><span>Date:</span><span>{new Date(created_at).toLocaleString('en-GH')}</span></div>
            <div className="flex justify-between"><span>Cashier:</span><span>{user?.full_name || '—'}</span></div>
            {customer && <div className="flex justify-between"><span>Customer:</span><span>{customer.name}</span></div>}
          </div>
          <div className="border-t border-dashed py-2 text-xs">
            <div className="flex justify-between font-bold mb-1">
              <span className="w-2/5">Item</span>
              <span className="w-1/5 text-right">Qty</span>
              <span className="w-1/5 text-right">Price</span>
              <span className="w-1/5 text-right">Total</span>
            </div>
            {(items || []).map((item, i) => (
              <div key={i} className="flex justify-between">
                <span className="w-2/5 truncate">{item.product?.name || item.name}</span>
                <span className="w-1/5 text-right">{item.quantity}</span>
                <span className="w-1/5 text-right">{formatCurrency(item.unit_price)}</span>
                <span className="w-1/5 text-right">{formatCurrency(item.total)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-dashed pt-2 text-xs space-y-0.5">
            <div className="flex justify-between"><span>Subtotal:</span><span>{formatCurrency(subtotal)}</span></div>
            {parseFloat(discount_amount) > 0 && <div className="flex justify-between"><span>Discount:</span><span>-{formatCurrency(discount_amount)}</span></div>}
            {parseFloat(tax_amount) > 0 && <div className="flex justify-between"><span>Tax:</span><span>{formatCurrency(tax_amount)}</span></div>}
            <div className="flex justify-between font-bold border-t pt-1"><span>TOTAL:</span><span>{formatCurrency(total_amount)}</span></div>
            <div className="flex justify-between"><span>Payment:</span><span>{payment_method}</span></div>
            {payment?.amount_paid && <div className="flex justify-between"><span>Paid:</span><span>{formatCurrency(payment.amount_paid)}</span></div>}
            {payment?.change_given > 0 && <div className="flex justify-between"><span>Change:</span><span>{formatCurrency(payment.change_given)}</span></div>}
            {payment?.reference && <div className="flex justify-between"><span>Ref:</span><span>{payment.reference}</span></div>}
          </div>
          <div className="border-t border-dashed mt-2 pt-2 text-center text-xs">{settings.receipt_footer || 'Thank you for choosing QuickMart!'}</div>
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-4 receipt-no-print">
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button variant="primary" onClick={handlePrint}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Print Receipt
        </Button>
      </div>
    </>
  )
}

// ─── Payment Modal ─────────────────────────────────────────────────────────────
function PaymentModal({ isOpen, onClose, total, onConfirm, isLoading, selectedCustomer }) {
  const [method, setMethod] = useState('CASH')
  const [amountPaid, setAmountPaid] = useState('')
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (isOpen) {
      setMethod('CASH')
      setAmountPaid('')
      setErrors({})
    }
  }, [isOpen])

  const change = method === 'CASH' ? parseFloat(amountPaid || 0) - total : 0

  function validate() {
    const errs = {}
    if (method === 'CASH') {
      if (!amountPaid || parseFloat(amountPaid) < total) {
        errs.amountPaid = `Amount must be at least ${formatCurrency(total)}`
      }
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  function handleConfirm() {
    if (method === 'CASH') {
      if (!validate()) return
      onConfirm({
        payment_method: 'CASH',
        amount_paid: parseFloat(amountPaid),
      })
      return
    }

    // CARD or MOBILE_MONEY — open Paystack popup
    const handler = window.PaystackPop.setup({
      key: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY,
      email: selectedCustomer?.email || 'guest@quickmart.com',
      amount: Math.round(total * 100), // Paystack uses pesewas
      currency: 'GHS',
      ref: 'QM-' + Date.now() + '-' + Math.floor(Math.random() * 1000000),
      channels: method === 'CARD' ? ['card'] : ['mobile_money'],
      metadata: {
        custom_fields: [
          { display_name: 'Store', variable_name: 'store', value: 'QuickMart' },
        ],
      },
      onClose: () => {
        toast.error('Payment was cancelled')
      },
      callback: (response) => {
        onConfirm({
          payment_method: method,
          amount_paid: total,
          reference: response.reference,
        })
      },
    })
    handler.openIframe()
  }

  const methods = [
    { value: 'CASH', label: 'Cash' },
    { value: 'MOBILE_MONEY', label: 'Mobile Money (Paystack)' },
    { value: 'CARD', label: 'Card (Paystack)' },
  ]

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Process Payment" size="sm">
      <div className="space-y-4">
        {/* Total */}
        <div className="bg-primary-50 border border-primary-100 rounded-lg p-4 text-center">
          <p className="text-sm text-primary-600 font-medium">Amount Due</p>
          <p className="text-3xl font-bold text-primary-700 mt-1">{formatCurrency(total)}</p>
        </div>

        {/* Payment Method */}
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Payment Method</p>
          <div className="grid grid-cols-3 gap-2">
            {methods.map((m) => (
              <button
                key={m.value}
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
              label="Amount Paid (GH₵)"
              type="number"
              min={total}
              step="0.01"
              value={amountPaid}
              onChange={(e) => { setAmountPaid(e.target.value); setErrors({}) }}
              placeholder={formatCurrency(total).replace('GH₵ ', '')}
              error={errors.amountPaid}
            />
            {parseFloat(amountPaid) >= total && (
              <div className="flex justify-between items-center bg-success-50 border border-success-100 rounded-lg px-3 py-2">
                <span className="text-sm text-success-700">Change</span>
                <span className="font-bold text-success-700">{formatCurrency(change)}</span>
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
          <Button variant="success" className="flex-1" onClick={handleConfirm} isLoading={isLoading}>
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
function CartItem({ item, onUpdate, onRemove, onDiscountChange }) {
  return (
    <div className="py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{item.name}</p>
          <p className="text-xs text-gray-400">{formatCurrency(item.price)} each</p>
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
            onChange={(e) => onUpdate(item.product_id, parseInt(e.target.value) || 1)}
            className="w-10 text-center text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded py-0.5 focus:outline-none focus:ring-1 focus:ring-primary-400"
          />
          <button
            onClick={() => onUpdate(item.product_id, item.quantity + 1)}
            disabled={item.quantity >= item.quantity_available}
            aria-label="Increase quantity"
            className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-100 transition text-sm disabled:opacity-40"
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
            step="0.01"
            value={item.discount || 0}
            onChange={(e) => onDiscountChange(item.product_id, parseFloat(e.target.value) || 0)}
            className="w-16 text-right text-xs border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded py-0.5 px-1 focus:outline-none focus:ring-1 focus:ring-primary-400"
          />
        </div>

        {/* Line total */}
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 min-w-[70px] text-right">
          {formatCurrency(item.price * item.quantity - (item.discount || 0))}
        </p>
      </div>
    </div>
  )
}

// ─── Main POSPage ──────────────────────────────────────────────────────────────
export default function POSPage() {
  const { user } = useAuth()
  const { loyalty_points_rate } = useSettings()
  const { items, cartDiscount, customer, subtotal, taxAmount, taxRate, total, addItem, removeItem, updateQuantity, updateDiscount, setCartDiscount, setCustomer, clearCart } = useCart()

  const [searchQuery, setSearchQuery] = useState('')
  const [products, setProducts] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showReceiptModal, setShowReceiptModal] = useState(false)
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [completedSale, setCompletedSale] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const searchRef = useRef(null)
  const barcodeBufferRef = useRef('')
  const barcodeTimerRef = useRef(null)

  // Focus search on mount
  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'F1') { e.preventDefault(); searchRef.current?.focus() }
      if (e.key === 'F2') { e.preventDefault(); if (items.length > 0 && customer) setShowPaymentModal(true) }
      if (e.key === 'F4') { e.preventDefault(); if (items.length > 0) setShowClearConfirm(true) }
      // Enter = confirm the active action (clear-cart confirmation dialog)
      if (e.key === 'Enter' && showClearConfirm) {
        e.preventDefault()
        clearCart()
        setShowClearConfirm(false)
        toast.success('Cart cleared')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [items.length, showClearConfirm, clearCart])

  // Barcode scanner detection: rapid keystrokes ending with Enter
  useEffect(() => {
    function onKeyDown(e) {
      // Only intercept if search input is NOT focused (or it is focused)
      if (e.key === 'Enter' && barcodeBufferRef.current.length >= 8) {
        const barcode = barcodeBufferRef.current
        barcodeBufferRef.current = ''
        clearTimeout(barcodeTimerRef.current)
        handleBarcodeSearch(barcode)
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

  async function handleBarcodeSearch(barcode) {
    try {
      const res = await productsService.byBarcode(barcode)
      const product = res.data?.data
      if (product) {
        if (product.quantity === 0) { toast.error(`${product.name} is out of stock`); return }
        addItem(product)
        toast.success(`${product.name} added to cart`)
      } else {
        toast.error('Product not found for barcode: ' + barcode)
      }
    } catch {
      toast.error('Barcode lookup failed')
    }
  }

  // Text search with debounce
  useEffect(() => {
    if (!searchQuery.trim()) { setProducts([]); return }
    setIsSearching(true)
    const id = setTimeout(async () => {
      try {
        const res = await productsService.list({ search: searchQuery, per_page: 20, is_active: true })
        setProducts(res.data?.data || [])
      } catch {
        setProducts([])
      } finally {
        setIsSearching(false)
      }
    }, 300)
    return () => clearTimeout(id)
  }, [searchQuery])

  function handleAddProduct(product) {
    if (product.quantity === 0) { toast.error(`${product.name} is out of stock`); return }
    addItem(product)
    setSearchQuery('')
    setProducts([])
    searchRef.current?.focus()
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
      } catch (_) {
        // sessionStorage unavailable — non-critical
      }
      if (reference) {
        toast.success(`Payment successful! Ref: ${reference}`)
      } else {
        toast.success('Sale completed successfully!')
      }
    } catch (err) {
      const msg = err.response?.data?.error?.message || 'Failed to process sale'
      toast.error(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0)

  return (
    <DashboardLayout noPad>
    <div className="flex flex-row-reverse h-[calc(100vh-4rem)] bg-gray-100 dark:bg-gray-950 overflow-hidden">
      {/* ── RIGHT PANEL: Product Search ── */}
      <div className="flex flex-col flex-1 min-w-0 p-4 gap-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">New Sale</h1>
            <p className="text-xs text-gray-400">
              <kbd className="bg-gray-200 px-1 rounded text-xs">F1</kbd> Search &nbsp;
              <kbd className="bg-gray-200 px-1 rounded text-xs">F2</kbd> Pay &nbsp;
              <kbd className="bg-gray-200 px-1 rounded text-xs">F4</kbd> Clear &nbsp;
              <kbd className="bg-gray-200 px-1 rounded text-xs">↵</kbd> Confirm
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Logged in as</p>
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{user?.role ? user.role[0] + user.role.slice(1).toLowerCase() : '—'}</p>
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
            placeholder="Search by name, SKU, or scan barcode… (F1)"
            className="w-full pl-9 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setProducts([]); searchRef.current?.focus() }}
              aria-label="Clear search"
              className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-y-auto">
          {isSearching && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="bg-white dark:bg-gray-900 rounded-xl p-3 animate-pulse">
                  <div className="h-4 bg-gray-200 rounded mb-2" />
                  <div className="h-3 bg-gray-100 rounded w-2/3" />
                </div>
              ))}
            </div>
          )}

          {!isSearching && searchQuery && products.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <svg className="w-12 h-12 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm">No products found for "{searchQuery}"</p>
            </div>
          )}

          {!isSearching && !searchQuery && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-300">
              <svg className="w-16 h-16 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <p className="text-base">Search for a product or scan a barcode</p>
            </div>
          )}

          {!isSearching && products.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {products.map((product) => (
                <button
                  key={product.id}
                  onClick={() => handleAddProduct(product)}
                  disabled={product.quantity === 0}
                  className={`bg-white dark:bg-gray-900 rounded-xl p-3 text-left shadow-sm border transition hover:shadow-md hover:border-primary-300 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
                    product.quantity === 0 ? 'border-gray-100 dark:border-gray-800' : 'border-gray-100 dark:border-gray-800 hover:border-primary-200'
                  }`}
                >
                  {product.image_url ? (
                    <img src={product.image_url} alt={product.name} className="w-full h-20 object-cover rounded-lg mb-2" />
                  ) : (
                    <div className="w-full h-20 bg-gray-100 rounded-lg mb-2 flex items-center justify-center">
                      <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                    </div>
                  )}
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{product.name}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{product.sku}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-sm font-bold text-primary-600">{formatCurrency(product.price)}</span>
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

      {/* ── LEFT PANEL: Cart + Payment ── */}
      <div className="w-96 flex-shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col shadow-xl">
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
              Clear
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
              <p className="text-xs">Search for products to add</p>
            </div>
          ) : (
            <div>
              {items.map((item) => (
                <CartItem
                  key={item.product_id}
                  item={item}
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
          {/* Customer selector */}
          {(() => {
            const loyaltyRate = parseFloat(loyalty_points_rate) || 10
            const pointsEarned = customer && loyaltyRate > 0 ? Math.floor(total / loyaltyRate) : 0
            return customer ? (
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
                className={`w-full flex items-center justify-between gap-2 border border-dashed rounded-lg px-3 py-2 text-sm transition
                  ${items.length > 0
                    ? 'border-warning-400 dark:border-warning-500 text-warning-600 dark:text-warning-400 hover:border-warning-500 hover:bg-warning-50 dark:hover:bg-warning-900/20'
                    : 'border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:border-primary-400 hover:text-primary-500 dark:hover:text-primary-400'
                  }`}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>Select Customer</span>
                </div>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
            )
          })()}

          {/* Cart discount */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">Cart Discount</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={cartDiscount || ''}
              onChange={(e) => setCartDiscount(parseFloat(e.target.value) || 0)}
              placeholder="0.00"
              className="flex-1 text-right border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg py-1.5 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Subtotal */}
          <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
            <span>Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          {(cartDiscount || 0) > 0 && (
            <div className="flex justify-between text-sm text-danger-600">
              <span>Discount</span>
              <span>-{formatCurrency(cartDiscount)}</span>
            </div>
          )}
          {taxRate > 0 && (
            <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
              <span>Tax ({taxRate}%)</span>
              <span>{formatCurrency(taxAmount)}</span>
            </div>
          )}

          {/* Total */}
          <div className="flex justify-between items-center pt-2 border-t border-gray-100 dark:border-gray-800">
            <span className="text-base font-bold text-gray-900 dark:text-gray-100">Total</span>
            <span className="text-2xl font-bold text-primary-600">{formatCurrency(total)}</span>
          </div>

          {/* Charge button */}
          <Button
            variant="success"
            size="lg"
            className="w-full text-base"
            disabled={items.length === 0 || !customer}
            onClick={() => setShowPaymentModal(true)}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            Charge {items.length > 0 && formatCurrency(total)} <span className="ml-1 text-xs opacity-75">(F2)</span>
          </Button>
          {items.length > 0 && !customer && (
            <p className="text-xs text-center text-warning-600 dark:text-warning-400">
              Select a customer to proceed
            </p>
          )}
        </div>
      </div>

      {/* ── Modals ── */}
      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        total={total}
        onConfirm={handlePaymentConfirm}
        isLoading={isSubmitting}
        selectedCustomer={customer}
      />

      <Modal
        isOpen={showReceiptModal}
        onClose={() => setShowReceiptModal(false)}
        title="Sale Complete — Receipt"
        size="md"
      >
        <Receipt sale={completedSale} onClose={() => setShowReceiptModal(false)} />
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
            onClick={() => { clearCart(); setShowClearConfirm(false); toast.success('Cart cleared') }}
          >
            Clear Cart
          </Button>
        </div>
      </Modal>
    </div>
    </DashboardLayout>
  )
}
