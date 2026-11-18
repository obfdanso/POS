// Builds the email version of a sale receipt. Every value that came from a user is escaped.

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

const METHOD_LABEL = { CASH: 'Cash', MOBILE_MONEY: 'Mobile Money', CARD: 'Card' }

/**
 * @param {object} sale - sale with sale_items (with product), payments, user, customer
 * @param {{ name: string, address?: string, phone?: string, currency: string, footer?: string }} store
 * @returns {{ subject: string, html: string, text: string }}
 */
function buildReceiptEmail(sale, store) {
  const money = (v) => `${store.currency} ${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const esc = escapeHtml
  const payment = sale.payments?.[0]
  const pointsDiscount = Number(sale.points_discount || 0)
  const cartDiscount = Math.round((Number(sale.discount_amount) - pointsDiscount) * 100) / 100
  const date = new Date(sale.created_at).toLocaleString('en-GH', { dateStyle: 'medium', timeStyle: 'short' })

  const totals = [
    ['Subtotal', money(sale.subtotal)],
    cartDiscount > 0 && ['Discount', `-${money(cartDiscount)}`],
    pointsDiscount > 0 && [`Points (${sale.loyalty_points_redeemed} pts)`, `-${money(pointsDiscount)}`],
    Number(sale.tax_amount) > 0 && ['Tax', money(sale.tax_amount)],
  ].filter(Boolean)
  const paymentRows = [
    ['Payment', METHOD_LABEL[sale.payment_method] || sale.payment_method],
    payment && ['Amount paid', money(payment.amount_paid)],
    payment && Number(payment.change_given) > 0 && ['Change', money(payment.change_given)],
    Number(sale.refunded_amount) > 0 && ['Refunded', money(sale.refunded_amount)],
    sale.loyalty_points_earned > 0 && ['Points earned', String(sale.loyalty_points_earned)],
  ].filter(Boolean)

  const row = ([label, value], bold) =>
    `<tr><td style="padding:2px 0;${bold ? 'font-weight:bold;' : ''}">${esc(label)}</td><td style="padding:2px 0;text-align:right;${bold ? 'font-weight:bold;' : ''}">${esc(value)}</td></tr>`

  const html = `<!DOCTYPE html>
<html><body style="margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827;">
<div style="max-width:480px;margin:24px auto;background:#fff;border-radius:8px;padding:24px;">
  <h1 style="margin:0;font-size:20px;text-align:center;">${esc(store.name)}</h1>
  ${store.address ? `<p style="margin:4px 0 0;text-align:center;color:#6b7280;font-size:13px;">${esc(store.address)}</p>` : ''}
  ${store.phone ? `<p style="margin:2px 0 0;text-align:center;color:#6b7280;font-size:13px;">Tel: ${esc(store.phone)}</p>` : ''}
  <p style="margin:16px 0 4px;font-size:13px;color:#6b7280;">Receipt <strong style="color:#111827;">${esc(sale.transaction_id)}</strong> · ${esc(date)}</p>
  <p style="margin:0 0 12px;font-size:13px;color:#6b7280;">Served by ${esc(sale.user?.full_name || '—')}${sale.customer ? ` · ${esc(sale.customer.name)}` : ''}</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;">
    <tr style="border-bottom:1px solid #e5e7eb;"><th style="text-align:left;padding:6px 0;">Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Total</th></tr>
    ${(sale.sale_items || [])
      .map(
        (i) =>
          `<tr><td style="padding:4px 0;">${esc(i.product?.name)}<br><span style="color:#6b7280;font-size:12px;">${esc(money(i.unit_price))} each${Number(i.discount) > 0 ? `, ${esc(money(i.discount))} off` : ''}</span></td><td style="text-align:center;">${esc(i.quantity)}</td><td style="text-align:right;">${esc(money(i.total))}</td></tr>`
      )
      .join('')}
  </table>
  <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px;border-top:1px solid #e5e7eb;">
    ${totals.map((t) => row(t)).join('')}
    ${row(['Total', money(sale.total_amount)], true)}
    ${paymentRows.map((t) => row(t)).join('')}
  </table>
  <p style="margin:20px 0 0;text-align:center;color:#6b7280;font-size:13px;">${esc(store.footer || 'Thank you for your business!')}</p>
</div>
</body></html>`

  const text = [
    store.name,
    `Receipt ${sale.transaction_id} · ${date}`,
    '',
    ...(sale.sale_items || []).map((i) => `${i.quantity} × ${i.product?.name}  ${money(i.total)}`),
    '',
    ...totals.map(([l, v]) => `${l}: ${v}`),
    `Total: ${money(sale.total_amount)}`,
    ...paymentRows.map(([l, v]) => `${l}: ${v}`),
    '',
    store.footer || 'Thank you for your business!',
  ].join('\n')

  return { subject: `Your receipt from ${store.name} (${sale.transaction_id})`, html, text }
}

module.exports = { buildReceiptEmail, escapeHtml }
