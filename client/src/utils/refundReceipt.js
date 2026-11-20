import { escapeHtml as esc, RECEIPT_STYLES } from './print'
import { METHOD_LABEL, splitOtherMethods } from './payments'

/**
 * Builds an 80mm refund slip for one return against a sale: the items that came back, what each
 * refunded, and who processed it. `sale` is the API sale (with `items` and `refunds`), `refund` one
 * of its `refunds`. Every user-provided value is escaped.
 */
export function buildRefundReceiptHtml(sale, refund, settings, fmt) {
  const lines = new Map((sale.items || []).map((i) => [i.id, i]))
  const itemsHTML = refund.items
    .map((ri) => {
      const line = lines.get(ri.sale_item_id)
      return `
      <tr>
        <td style="text-align:left;padding:2px 0;">${esc(line?.product?.name || 'Item')}${ri.restocked ? '' : '<br><small>(not restocked)</small>'}</td>
        <td style="text-align:center;padding:2px 0;">${esc(ri.quantity)}</td>
        <td style="text-align:right;padding:2px 0;">${fmt(ri.amount)}</td>
      </tr>`
    })
    .join('')
  const method = METHOD_LABEL[refund.method] || refund.method
  const isLast = sale.refunds?.[sale.refunds.length - 1]?.id === refund.id
  // The branch that took the goods back and paid out, with its own address where it has one
  const branch = refund.branch ?? sale.branch
  const address = branch?.address || settings.store_address
  const phone = branch?.phone || settings.store_phone

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Refund ${esc(sale.transaction_id)}</title>
  <style>${RECEIPT_STYLES}
  </style>
</head>
<body>
  <div class="center">
    <div class="bold" style="font-size:14px;">${esc(settings.store_name || 'QuickMart')}</div>
    ${branch?.name ? `<div>${esc(branch.name)}</div>` : ''}
    ${address ? `<div>${esc(address)}</div>` : ''}
    ${phone ? `<div>Tel: ${esc(phone)}</div>` : ''}
    <div class="bold" style="margin-top:4px;">*** REFUND ***</div>
  </div>
  <div class="dashed"></div>
  <div class="row"><span>Sale:</span><span>${esc(sale.transaction_id)}</span></div>
  <div class="row"><span>Sold:</span><span>${new Date(sale.created_at).toLocaleString('en-GH')}</span></div>
  <div class="row"><span>Refunded:</span><span>${new Date(refund.created_at).toLocaleString('en-GH')}</span></div>
  <div class="row"><span>By:</span><span>${esc(refund.user?.full_name || '—')}</span></div>
  ${sale.customer ? `<div class="row"><span>Customer:</span><span>${esc(sale.customer.name)}</span></div>` : ''}
  <div class="dashed"></div>
  <table>
    <thead>
      <tr>
        <th>Item returned</th>
        <th style="text-align:center;">Qty</th>
        <th style="text-align:right;">Refund</th>
      </tr>
    </thead>
    <tbody>${itemsHTML}</tbody>
  </table>
  <div class="dashed"></div>
  <div class="row"><span>Reason:</span><span>${esc(refund.reason)}</span></div>
  <div class="row bold" style="font-size:14px;"><span>REFUNDED:</span><span>${fmt(refund.amount)}</span></div>
  ${refund.method === 'SPLIT'
    ? `<div class="row"><span>In cash:</span><span>${fmt(refund.cash_amount)}</span></div>
  ${parseFloat(refund.amount) > parseFloat(refund.cash_amount) ? `<div class="row"><span>By ${esc(splitOtherMethods(sale))}:</span><span>${fmt(parseFloat(refund.amount) - parseFloat(refund.cash_amount))}</span></div>` : ''}`
    : `<div class="row"><span>Paid back by:</span><span>${esc(method)}</span></div>`}
  ${refund.gateway_status && refund.gateway_status !== 'NOT_SENT' ? '<div class="center" style="margin-top:4px;">Card and Mobile Money refunds can take a few days to arrive.</div>' : ''}
  ${isLast ? `<div class="row"><span>Sale total refunded:</span><span>${fmt(sale.refunded_amount)} of ${fmt(sale.total_amount)}</span></div>` : ''}
  <div class="dashed"></div>
  <div class="center">Customer signature</div>
  <div style="border-bottom:1px solid #000;height:24px;margin:4px 8mm 0;"></div>
</body>
</html>`
}
