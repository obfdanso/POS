import { useState, useEffect, useCallback, useRef } from 'react'
import toast from 'react-hot-toast'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Modal } from '../components/Modal'
import { Table } from '../components/Table'
import { Badge } from '../components/Badge'
import { promotionsService } from '../services/promotions'
import { productsService } from '../services/products'
import { getErrorMessage, getFieldErrors } from '../utils/apiErrors'

const STATUS = {
  ACTIVE: { label: 'Running', variant: 'success' },
  SCHEDULED: { label: 'Scheduled', variant: 'primary' },
  ENDED: { label: 'Ended', variant: 'default' },
  OFF: { label: 'Off', variant: 'default' },
}

const selectClass =
  'block w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'

const formatDateTime = (value) =>
  value ? new Date(value).toLocaleString('en-GH', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null

// <input type="datetime-local"> works in local time without a zone
function toLocalInput(value) {
  if (!value) return ''
  const d = new Date(value)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

const appliesTo = (p) => (p.product ? p.product.name : p.category ? `All ${p.category.name}` : 'Whole store')

// Product search for single-product promotions
function ProductSearch({ value, onChange, error }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const latest = useRef(0)

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) return undefined
    const requestId = ++latest.current
    const timer = setTimeout(() => {
      productsService.list({ search: term, per_page: 8 })
        .then((res) => { if (requestId === latest.current) setResults(res.data?.data || []) })
        .catch(() => {})
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm">
        <span className="text-gray-900 dark:text-gray-100 truncate">{value.name} <span className="text-gray-400">· {value.sku}</span></span>
        <button type="button" onClick={() => onChange(null)} className="text-primary-600 text-xs font-semibold hover:underline">Change</button>
      </div>
    )
  }
  return (
    <div className="relative">
      <Input aria-label="Product" placeholder="Search by name, SKU or barcode" value={query} onChange={(e) => setQuery(e.target.value)} error={error} />
      {query.trim().length >= 2 && results.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
          {results.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => { onChange(p); setQuery('') }} className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 dark:hover:bg-primary-900/20">
                {p.name} <span className="text-gray-400">· {p.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PromotionModal({ promotion, categories, onClose, onSaved }) {
  const editing = Boolean(promotion)
  const [form, setForm] = useState(() => ({
    name: promotion?.name ?? '',
    percent_off: promotion ? String(Number(promotion.percent_off)) : '',
    target: promotion?.product ? 'product' : promotion?.category ? 'category' : 'store',
    category_id: promotion?.category?.id ?? '',
    product: promotion?.product ?? null,
    starts_at: toLocalInput(promotion?.starts_at),
    ends_at: toLocalInput(promotion?.ends_at),
  }))
  const [errors, setErrors] = useState({})
  const [isSaving, setIsSaving] = useState(false)

  const set = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  function validate() {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Give the promotion a name'
    const pct = Number(form.percent_off)
    if (!form.percent_off || Number.isNaN(pct) || pct <= 0 || pct > 100) errs.percent_off = 'Enter a percentage between 0.01 and 100'
    if (form.target === 'category' && !form.category_id) errs.category_id = 'Choose a category'
    if (form.target === 'product' && !form.product) errs.product_id = 'Choose a product'
    if (form.ends_at && new Date(form.ends_at) <= new Date(form.starts_at || Date.now())) errs.ends_at = 'The end must be after the start'
    return errs
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    setErrors(errs)
    if (Object.keys(errs).length) return
    const payload = {
      name: form.name.trim(),
      percent_off: Number(form.percent_off),
      product_id: form.target === 'product' ? form.product.id : null,
      category_id: form.target === 'category' ? form.category_id : null,
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      ...(form.starts_at && { starts_at: new Date(form.starts_at).toISOString() }),
    }
    setIsSaving(true)
    try {
      const res = editing ? await promotionsService.update(promotion.id, payload) : await promotionsService.create(payload)
      toast.success(res.data.message)
      onSaved()
    } catch (err) {
      const fieldErrors = getFieldErrors(err)
      setErrors(fieldErrors)
      if (!Object.keys(fieldErrors).length) toast.error(getErrorMessage(err, 'Failed to save the promotion'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={editing ? 'Edit promotion' : 'New promotion'} size="md">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Input label="Name (shown on receipts)" value={form.name} maxLength={100} onChange={(e) => set('name', e.target.value)} error={errors.name} placeholder="e.g. Weekend drinks deal" />
        <Input label="Percent off" type="number" min={0.01} max={100} step="0.01" value={form.percent_off} onChange={(e) => set('percent_off', e.target.value)} error={errors.percent_off} />
        <div className="flex flex-col gap-1">
          <label htmlFor="promo-target" className="text-sm font-medium text-gray-700 dark:text-gray-300">Applies to</label>
          <select id="promo-target" value={form.target} onChange={(e) => set('target', e.target.value)} className={selectClass}>
            <option value="store">Every product in the store</option>
            <option value="category">Every product in a category</option>
            <option value="product">One product</option>
          </select>
        </div>
        {form.target === 'category' && (
          <div className="flex flex-col gap-1">
            <label htmlFor="promo-category" className="text-sm font-medium text-gray-700 dark:text-gray-300">Category</label>
            <select id="promo-category" value={form.category_id} onChange={(e) => set('category_id', e.target.value)} className={selectClass}>
              <option value="">Choose a category…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {errors.category_id && <p className="text-xs text-danger-600 dark:text-danger-400">{errors.category_id}</p>}
          </div>
        )}
        {form.target === 'product' && <ProductSearch value={form.product} onChange={(p) => set('product', p)} error={errors.product_id} />}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Starts (blank = now)" type="datetime-local" value={form.starts_at} onChange={(e) => set('starts_at', e.target.value)} error={errors.starts_at} />
          <Input label="Ends (optional)" type="datetime-local" value={form.ends_at} onChange={(e) => set('ends_at', e.target.value)} error={errors.ends_at} />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Promotions apply automatically at the till. If several apply to an item, the biggest one is used. Cashiers can still add their own discount on top.
        </p>
        <div className="flex gap-3">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button type="submit" className="flex-1" isLoading={isSaving}>{editing ? 'Save changes' : 'Create promotion'}</Button>
        </div>
      </form>
    </Modal>
  )
}

export default function PromotionsPage() {
  const [promotions, setPromotions] = useState([])
  const [categories, setCategories] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState(null) // null = closed, {} = new, promotion = edit
  const latestRequest = useRef(0)

  useEffect(() => {
    productsService.categories()
      .then((res) => setCategories(res.data?.data || []))
      .catch(() => {})
  }, [])

  const fetchPromotions = useCallback(async () => {
    const requestId = ++latestRequest.current
    setIsLoading(true)
    try {
      const res = await promotionsService.list(status ? { status } : {})
      if (requestId === latestRequest.current) setPromotions(res.data?.data || [])
    } catch (err) {
      if (requestId === latestRequest.current) toast.error(getErrorMessage(err, 'Failed to load promotions'))
    } finally {
      if (requestId === latestRequest.current) setIsLoading(false)
    }
  }, [status])

  useEffect(() => {
    fetchPromotions()
  }, [fetchPromotions])

  async function toggle(promo) {
    try {
      await promotionsService.update(promo.id, { is_active: !promo.is_active })
      toast.success(promo.is_active ? `${promo.name} switched off` : `${promo.name} switched on`)
      fetchPromotions()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update the promotion'))
    }
  }

  const columns = [
    { key: 'name', label: 'Promotion', sortable: true },
    { key: 'percent_off', label: 'Off', sortable: true, sortValue: (row) => Number(row.percent_off), render: (v) => `${Number(v)}%` },
    { key: 'applies_to', label: 'Applies to', sortable: true, sortValue: appliesTo, render: (_, row) => appliesTo(row) },
    {
      key: 'starts_at',
      label: 'When',
      sortable: true,
      render: (_, row) => `${formatDateTime(row.starts_at)} → ${formatDateTime(row.ends_at) ?? 'no end'}`,
    },
    { key: 'times_used', label: 'Sale lines', sortable: true },
    { key: 'status', label: 'Status', sortable: true, render: (v) => <Badge variant={STATUS[v]?.variant}>{STATUS[v]?.label ?? v}</Badge> },
    {
      key: 'actions',
      label: '',
      render: (_, row) => (
        <div className="flex justify-end gap-3 text-xs font-semibold" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="text-primary-600 dark:text-primary-400 hover:underline" onClick={() => setEditing(row)}>Edit</button>
          <button type="button" className="text-gray-500 hover:underline" onClick={() => toggle(row)}>{row.is_active ? 'Switch off' : 'Switch on'}</button>
        </div>
      ),
    },
  ]

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Promotions</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Automatic percentage discounts on a product, a category, or the whole store</p>
          </div>
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="promo-status" className="text-sm font-medium text-gray-700 dark:text-gray-300">Show</label>
              <select id="promo-status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
                <option value="">All promotions</option>
                {Object.entries(STATUS).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <Button onClick={() => setEditing({})}>New promotion</Button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <Table
            columns={columns}
            data={promotions}
            isLoading={isLoading}
            onRowClick={(row) => setEditing(row)}
            emptyMessage="No promotions yet. Create one to discount a product, a category, or the whole store."
          />
        </div>
      </div>

      {editing && (
        <PromotionModal
          promotion={editing.id ? editing : null}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            fetchPromotions()
          }}
        />
      )}
    </DashboardLayout>
  )
}
