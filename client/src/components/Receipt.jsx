import toast from 'react-hot-toast'
import { Button } from './Button'
import { useSettings } from '../context/SettingsContext'
import { formatCurrency } from '../utils/formatCurrency'

// Escape text before writing it into the print window's HTML
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

function formatMethod(method) {
  return method?.replace('_', ' ') ?? ''
}

// Builds a standalone 80mm thermal receipt document for the print window
function buildReceiptHtml(sale, settings, fmt) {
  const esc = escapeHtml
  const { transaction_id, created_at, user, customer, items, subtotal, discount_amount, tax_amount, total_amount, payment_method, payment, payment_status } = sale

  const itemsHTML = (items || []).map((item) => `
      <tr>
        <td style="text-align:left;padding:2px 0;">${esc(item.product?.name || item.name)}</td>
        <td style="text-align:center;padding:2px 4px;">${item.quantity}</td>
        <td style="text-align:right;padding:2px 4px;">${fmt(item.unit_price)}</td>
        <td style="text-align:right;padding:2px 0;">${fmt(item.total)}</td>
      </tr>`).join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt ${esc(transaction_id)}</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    body { font-family: monospace; font-size: 12px; width: 72mm; margin: 0 auto; padding: 4mm; color: #000; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .dashed { border-top: 1px dashed #000; margin: 6px 0; }
    .row { display: flex; justify-content: space-between; margin: 2px 0; }
  </style>
</head>
<body>
  <div class="center">
    <div class="bold" style="font-size:14px;">${esc(settings.store_name || 'QuickMart')}</div>
    ${settings.store_address ? `<div>${esc(settings.store_address)}</div>` : ''}
    ${settings.store_phone ? `<div>Tel: ${esc(settings.store_phone)}</div>` : ''}
  </div>
  ${payment_status === 'REFUNDED' ? '<div class="center bold" style="margin-top:4px;">*** REFUNDED ***</div>' : ''}
  <div class="dashed"></div>
  <div class="row"><span>TXN:</span><span>${esc(transaction_id)}</span></div>
  <div class="row"><span>Date:</span><span>${new Date(created_at).toLocaleString('en-GH')}</span></div>
  <div class="row"><span>Cashier:</span><span>${esc(user?.full_name || '—')}</span></div>
  ${customer ? `<div class="row"><span>Customer:</span><span>${esc(customer.name)}</span></div>` : ''}
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
  <div class="row"><span>Payment:</span><span>${esc(formatMethod(payment_method))}</span></div>
  ${payment?.amount_paid ? `<div class="row"><span>Amount Paid:</span><span>${fmt(payment.amount_paid)}</span></div>` : ''}
  ${parseFloat(payment?.change_given) > 0 ? `<div class="row"><span>Change:</span><span>${fmt(payment.change_given)}</span></div>` : ''}
  ${payment?.reference ? `<div class="row"><span>Reference:</span><span>${esc(payment.reference)}</span></div>` : ''}
  <div class="dashed"></div>
  <div class="center">${esc(settings.receipt_footer || 'Thank you for choosing QuickMart!')}</div>
</body>
</html>`
}

function Row({ label, value, className = '' }) {
  return (
    <div className={`flex justify-between ${className}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

/**
 * Printable receipt for a sale as returned by the API (with `items` and `payment`).
 * Shown on screen in a modal; "Print" opens an 80mm thermal layout and calls window.print().
 */
export function Receipt({ sale, onClose }) {
  const settings = useSettings()
  const fmt = (v) => formatCurrency(v, settings.currency_symbol || 'GH₵')

  if (!sale) return null

  const { transaction_id, created_at, user, customer, items, subtotal, discount_amount, tax_amount, total_amount, payment_method, payment, payment_status } = sale

  function handlePrint() {
    const win = window.open('', '_blank', 'width=420,height=640')
    if (!win) {
      toast.error('Allow pop-ups for this site to print receipts')
      return
    }
    // Every user-provided value in the template is escaped by buildReceiptHtml
    win.document.write(buildReceiptHtml(sale, settings, fmt))
    win.document.close()
    win.focus()
    win.addEventListener('afterprint', () => win.close())
    win.print()
  }

  return (
    <>
      <div className="font-mono text-sm bg-white text-gray-900 rounded-lg">
        <div className="text-center mb-3">
          <p className="font-bold text-base">{settings.store_name || 'QuickMart'}</p>
          {settings.store_address && <p className="text-xs text-gray-500">{settings.store_address}</p>}
          {settings.store_phone && <p className="text-xs text-gray-500">Tel: {settings.store_phone}</p>}
          {payment_status === 'REFUNDED' && <p className="mt-1 text-xs font-bold text-danger-600">*** REFUNDED ***</p>}
        </div>

        <div className="border-t border-dashed border-gray-400 pt-2 mb-2 text-xs">
          <Row label="TXN:" value={<span className="font-semibold">{transaction_id}</span>} />
          <Row label="Date:" value={new Date(created_at).toLocaleString('en-GH')} />
          <Row label="Cashier:" value={user?.full_name || '—'} />
          {customer && <Row label="Customer:" value={customer.name} />}
        </div>

        <div className="border-t border-dashed border-gray-400 py-2 text-xs">
          <div className="flex justify-between font-semibold mb-1">
            <span className="w-2/5">Item</span>
            <span className="w-1/5 text-right">Qty</span>
            <span className="w-1/5 text-right">Price</span>
            <span className="w-1/5 text-right">Total</span>
          </div>
          {(items || []).map((item) => (
            <div key={item.id ?? item.product_id} className="flex justify-between py-0.5">
              <span className="w-2/5 truncate">{item.product?.name || item.name}</span>
              <span className="w-1/5 text-right">{item.quantity}</span>
              <span className="w-1/5 text-right">{fmt(item.unit_price)}</span>
              <span className="w-1/5 text-right">{fmt(item.total)}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-dashed border-gray-400 pt-2 text-xs space-y-1">
          <Row label="Subtotal:" value={fmt(subtotal)} />
          {parseFloat(discount_amount) > 0 && <Row label="Discount:" value={`-${fmt(discount_amount)}`} className="text-danger-600" />}
          {parseFloat(tax_amount) > 0 && <Row label="Tax:" value={fmt(tax_amount)} />}
          <Row label="TOTAL:" value={fmt(total_amount)} className="font-bold text-base border-t border-gray-300 pt-1 mt-1" />
          <Row label="Payment:" value={formatMethod(payment_method)} />
          {payment && (
            <>
              <Row label="Amount Paid:" value={fmt(payment.amount_paid)} />
              {parseFloat(payment.change_given) > 0 && <Row label="Change:" value={fmt(payment.change_given)} className="font-semibold" />}
              {payment.reference && <Row label="Reference:" value={payment.reference} />}
            </>
          )}
        </div>

        <div className="border-t border-dashed border-gray-400 mt-3 pt-2 text-center text-xs text-gray-500">
          <p>{settings.receipt_footer || 'Thank you for choosing QuickMart!'}</p>
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-4">
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button variant="primary" onClick={handlePrint} autoFocus>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Print Receipt
        </Button>
      </div>
    </>
  )
}
