import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { Button } from './Button'
import { Input } from './Input'
import { Modal } from './Modal'
import { Badge } from './Badge'
import { purchaseOrdersService } from '../services/purchaseOrders'
import { productsService } from '../services/products'
import { formatCurrency } from '../utils/formatCurrency'
import { getErrorMessage, getFieldErrors } from '../utils/apiErrors'
import { PO_STATUS, orderTotal } from '../utils/purchaseOrders'

export function PoStatusBadge({ status }) {
  const s = PO_STATUS[status] ?? { label: status, variant: 'default' }
  return <Badge variant={s.variant}>{s.label}</Badge>
}

const selectClass =
  'block w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
const cellInput =
  'w-full text-right border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg py-1 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500'

// Search box that offers matching products to add as order lines
function ProductPicker({ onPick, exclude }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const latest = useRef(0)

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) return undefined
    const requestId = ++latest.current
    const timer = setTimeout(() => {
      productsService
        .list({ search: term, per_page: 8 })
        .then((res) => { if (requestId === latest.current) setResults(res.data?.data || []) })
        .catch(() => { if (requestId === latest.current) setResults([]) })
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  const visible = query.trim().length >= 2 ? results.filter((p) => !exclude.has(p.id)) : []

  return (
    <div className="relative">
      <Input aria-label="Add a product" placeholder="Search products to add by name, SKU or barcode" value={query} onChange={(e) => setQuery(e.target.value)} />
      {visible.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
          {visible.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(p)
                  setQuery('')
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 dark:hover:bg-primary-900/20 flex justify-between gap-3"
              >
                <span className="truncate">{p.name} <span className="text-gray-400">· {p.sku}</span></span>
                <span className="text-gray-500 dark:text-gray-400 flex-shrink-0">{p.quantity} in stock</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Form for a new purchase order: supplier, lines (with low-stock suggestions), expected date, notes. */
export function NewPurchaseOrderModal({ onClose, onCreated }) {
  const [suppliers, setSuppliers] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [lines, setLines] = useState([])
  const [expectedAt, setExpectedAt] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState({})
  const [isSaving, setIsSaving] = useState(false)
  const [isSuggesting, setIsSuggesting] = useState(false)

  useEffect(() => {
    purchaseOrdersService.suppliers()
      .then((res) => setSuppliers(res.data?.data || []))
      .catch(() => toast.error('Failed to load suppliers'))
  }, [])

  function addLine(product, quantity = 1, unitCost = product.cost_price) {
    setLines((prev) =>
      prev.some((l) => l.product_id === product.id)
        ? prev
        : [...prev, { product_id: product.id, name: product.name, sku: product.sku, quantity: String(quantity), unit_cost: unitCost == null ? '' : String(unitCost) }]
    )
    setErrors((prev) => ({ ...prev, items: undefined }))
  }

  function updateLine(productId, field, value) {
    setLines((prev) => prev.map((l) => (l.product_id === productId ? { ...l, [field]: value } : l)))
  }

  async function addSuggestions() {
    setIsSuggesting(true)
    try {
      const res = await purchaseOrdersService.suggestions(supplierId)
      const suggestions = res.data?.data || []
      if (suggestions.length === 0) toast('Nothing from this supplier is running low')
      for (const s of suggestions) addLine({ id: s.product_id, name: s.name, sku: s.sku, cost_price: s.unit_cost }, s.suggested_quantity)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load suggestions'))
    } finally {
      setIsSuggesting(false)
    }
  }

  function validate() {
    const errs = {}
    if (!supplierId) errs.supplier_id = 'Choose a supplier'
    if (lines.length === 0) errs.items = 'Add at least one product'
    for (const l of lines) {
      const qty = Number(l.quantity)
      const cost = Number(l.unit_cost)
      if (!Number.isInteger(qty) || qty < 1) errs.items = `Enter a whole-number quantity of at least 1 for ${l.name}`
      else if (l.unit_cost === '' || Number.isNaN(cost) || cost < 0) errs.items = `Enter a unit cost for ${l.name}`
    }
    return errs
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    setErrors(errs)
    if (Object.keys(errs).length) return
    setIsSaving(true)
    try {
      const res = await purchaseOrdersService.create({
        supplier_id: supplierId,
        items: lines.map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity), unit_cost: Number(l.unit_cost) })),
        ...(expectedAt && { expected_at: expectedAt }),
        ...(notes.trim() && { notes: notes.trim() }),
      })
      toast.success(res.data.message)
      onCreated(res.data.data)
    } catch (err) {
      const fieldErrors = getFieldErrors(err)
      setErrors(fieldErrors)
      if (!Object.keys(fieldErrors).length) toast.error(getErrorMessage(err, 'Failed to create the order'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="New purchase order" size="xl">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor="po-supplier" className="text-sm font-medium text-gray-700 dark:text-gray-300">Supplier</label>
            <div className="flex gap-2">
              <select
                id="po-supplier"
                value={supplierId}
                onChange={(e) => { setSupplierId(e.target.value); setErrors((p) => ({ ...p, supplier_id: undefined })) }}
                className={`${selectClass} flex-1`}
              >
                <option value="">Choose a supplier…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <Button type="button" variant="secondary" size="sm" disabled={!supplierId} isLoading={isSuggesting} onClick={addSuggestions} title="Add this supplier's low-stock products">
                Add low-stock items
              </Button>
            </div>
            {errors.supplier_id && <p className="text-xs text-danger-600 dark:text-danger-400">{errors.supplier_id}</p>}
          </div>
          <Input label="Expected delivery (optional)" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
        </div>

        <ProductPicker onPick={(p) => addLine(p)} exclude={new Set(lines.map((l) => l.product_id))} />

        <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">Product</th>
                <th className="text-right px-3 py-2 w-28">Quantity</th>
                <th className="text-right px-3 py-2 w-32">Unit cost</th>
                <th className="text-right px-3 py-2 w-32">Line total</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">Search for products above, or add the supplier's low-stock items.</td></tr>
              )}
              {lines.map((l) => (
                <tr key={l.product_id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{l.name} <span className="text-gray-400 text-xs">{l.sku}</span></td>
                  <td className="px-3 py-2">
                    <input type="number" min={1} step={1} aria-label={`Quantity of ${l.name}`} value={l.quantity} onChange={(e) => updateLine(l.product_id, 'quantity', e.target.value)} className={cellInput} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min={0} step="0.01" aria-label={`Unit cost of ${l.name}`} value={l.unit_cost} onChange={(e) => updateLine(l.product_id, 'unit_cost', e.target.value)} className={cellInput} />
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{formatCurrency(orderTotal([l]))}</td>
                  <td className="px-2 py-2 text-center">
                    <button type="button" aria-label={`Remove ${l.name}`} onClick={() => setLines((prev) => prev.filter((x) => x.product_id !== l.product_id))} className="text-gray-400 hover:text-danger-500">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr className="border-t border-gray-200 dark:border-gray-700 font-semibold text-gray-900 dark:text-gray-100">
                  <td className="px-3 py-2" colSpan={3}>Order total</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(orderTotal(lines))}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {errors.items && <p className="text-xs text-danger-600 dark:text-danger-400">{errors.items}</p>}

        <Input label="Notes (optional)" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} error={errors.notes} />

        <div className="flex gap-3">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button type="submit" className="flex-1" isLoading={isSaving}>Place order</Button>
        </div>
      </form>
    </Modal>
  )
}

/** One order with what has arrived so far; open orders can receive a delivery or be cancelled. */
export function PurchaseOrderDetailModal({ orderId, onClose, onChanged }) {
  const [po, setPo] = useState(null)
  const [receiving, setReceiving] = useState({})
  const [updateCost, setUpdateCost] = useState(true)
  const [deliveryNote, setDeliveryNote] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)

  useEffect(() => {
    let cancelled = false
    purchaseOrdersService.get(orderId)
      .then((res) => {
        if (cancelled) return
        const order = res.data.data
        setPo(order)
        // Start with everything still outstanding, the usual case for a delivery
        setReceiving(Object.fromEntries(order.items.map((i) => [i.id, String(i.quantity_outstanding)])))
      })
      .catch((err) => {
        if (cancelled) return
        toast.error(getErrorMessage(err, 'Failed to load the order'))
        onClose()
      })
    return () => { cancelled = true }
  }, [orderId, onClose])

  const isOpen = po && ['ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status)
  const toReceive = po ? po.items.map((i) => ({ item_id: i.id, quantity: parseInt(receiving[i.id], 10) || 0 })).filter((i) => i.quantity > 0) : []
  const overReceived = po?.items.find((i) => (parseInt(receiving[i.id], 10) || 0) > i.quantity_outstanding)

  function refresh(order) {
    setPo(order)
    setReceiving(Object.fromEntries(order.items.map((i) => [i.id, String(i.quantity_outstanding)])))
    onChanged()
  }

  async function handleReceive() {
    setIsSaving(true)
    try {
      const res = await purchaseOrdersService.receive(po.id, { items: toReceive, update_cost: updateCost, ...(deliveryNote.trim() && { notes: deliveryNote.trim() }) })
      toast.success(res.data.message)
      setDeliveryNote('')
      refresh(res.data.data)
    } catch (err) {
      toast.error(getFieldErrors(err).items || getErrorMessage(err, 'Failed to receive the delivery'))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleCancel() {
    setIsSaving(true)
    try {
      const res = await purchaseOrdersService.cancel(po.id)
      toast.success(res.data.message)
      setConfirmCancel(false)
      refresh(res.data.data)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to cancel the order'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={po ? `Purchase order ${po.po_number}` : 'Purchase order'} size="xl">
      {!po ? (
        <div className="space-y-2 py-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="text-gray-600 dark:text-gray-300">
              <span className="font-semibold text-gray-900 dark:text-gray-100">{po.supplier.name}</span>
              {' · '}ordered {new Date(po.created_at).toLocaleDateString('en-GH', { day: '2-digit', month: 'short', year: 'numeric' })} by {po.created_by.full_name}
              {po.expected_at && <> · expected {new Date(po.expected_at).toLocaleDateString('en-GH', { day: '2-digit', month: 'short' })}</>}
            </div>
            <PoStatusBadge status={po.status} />
          </div>
          {po.notes && <p className="text-sm text-gray-500 dark:text-gray-400">{po.notes}</p>}

          <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Product</th>
                  <th className="text-right px-3 py-2">Unit cost</th>
                  <th className="text-right px-3 py-2">Ordered</th>
                  <th className="text-right px-3 py-2">Received</th>
                  {isOpen && <th className="text-right px-3 py-2 w-32">Receive now</th>}
                </tr>
              </thead>
              <tbody>
                {po.items.map((i) => (
                  <tr key={i.id} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{i.product.name} <span className="text-gray-400 text-xs">{i.product.sku}</span></td>
                    <td className="px-3 py-2 text-right">{formatCurrency(i.unit_cost)}</td>
                    <td className="px-3 py-2 text-right">{i.quantity_ordered}</td>
                    <td className="px-3 py-2 text-right">{i.quantity_received}</td>
                    {isOpen && (
                      <td className="px-3 py-2">
                        {i.quantity_outstanding > 0 ? (
                          <input
                            type="number"
                            min={0}
                            max={i.quantity_outstanding}
                            step={1}
                            aria-label={`Quantity of ${i.product.name} received`}
                            value={receiving[i.id] ?? ''}
                            onChange={(e) => setReceiving((prev) => ({ ...prev, [i.id]: e.target.value }))}
                            className={cellInput}
                          />
                        ) : (
                          <p className="text-right text-success-600 text-xs font-medium">Complete</p>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 dark:border-gray-700 font-semibold text-gray-900 dark:text-gray-100">
                  <td className="px-3 py-2">Order total</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(po.total_cost)}</td>
                  <td className="px-3 py-2 text-right">{po.units_ordered}</td>
                  <td className="px-3 py-2 text-right">{po.units_received}</td>
                  {isOpen && <td />}
                </tr>
              </tfoot>
            </table>
          </div>

          {isOpen && (
            <div className="space-y-3">
              {overReceived && (
                <p className="text-xs text-danger-600 dark:text-danger-400">Only {overReceived.quantity_outstanding} more of {overReceived.product.name} {overReceived.quantity_outstanding === 1 ? 'is' : 'are'} expected.</p>
              )}
              <Input label="Delivery note (optional)" value={deliveryNote} maxLength={300} onChange={(e) => setDeliveryNote(e.target.value)} placeholder="e.g. invoice number or who delivered" />
              <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                Update each product's cost price to this order's unit cost (used for profit reports)
              </label>
              {confirmCancel ? (
                <div className="rounded-lg border border-danger-200 bg-danger-50 dark:bg-danger-900/20 p-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-danger-700 dark:text-danger-400">Cancel this order? Goods already received stay in stock.</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setConfirmCancel(false)} disabled={isSaving}>Keep it</Button>
                    <Button size="sm" variant="danger" onClick={handleCancel} isLoading={isSaving}>Cancel order</Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  <Button variant="secondary" onClick={() => setConfirmCancel(true)} disabled={isSaving}>Cancel order</Button>
                  <Button className="flex-1" onClick={handleReceive} isLoading={isSaving} disabled={toReceive.length === 0 || Boolean(overReceived)}>
                    Receive {toReceive.reduce((n, i) => n + i.quantity, 0)} unit{toReceive.reduce((n, i) => n + i.quantity, 0) === 1 ? '' : 's'} into stock
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
