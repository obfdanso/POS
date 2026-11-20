import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Modal } from '../components/Modal'
import { productsService } from '../services/products'
import { useSettings } from '../context/SettingsContext'
import api from '../services/api'
import { useAuth } from '../hooks/useAuth'
import { useBranch } from '../hooks/useBranch'
import { getFieldErrors, getErrorMessage } from '../utils/apiErrors'

const isWholeAtLeastZero = (v) => v !== '' && Number.isInteger(Number(v)) && Number(v) >= 0

/**
 * Which branches stock the product. One row per branch this user manages (all open branches for an
 * admin, their own for a manager): a tick box, a starting quantity for branches that newly stock it,
 * and the branch's low-stock level. Stock that is already there changes through Inventory.
 */
function StockedAt({ rows, onChange, errors, loaded, failed, onRetry }) {
  if (failed) {
    return (
      <p className="text-sm text-danger-600">
        Couldn&apos;t load the branches.{' '}
        <button type="button" onClick={onRetry} className="font-semibold underline">Try again</button>
      </p>
    )
  }
  if (!loaded) return <p className="text-sm text-gray-400">Loading branches…</p>
  return (
    <div className="space-y-2">
      <div className="hidden sm:grid grid-cols-[1fr_8rem_8rem] gap-3 px-1 text-xs font-medium text-gray-500 dark:text-gray-400">
        <span>Branch</span>
        <span>Quantity</span>
        <span>Low-stock level</span>
      </div>
      {rows.map((row) => {
        const locked = row.existing && row.current > 0
        return (
          <div key={row.branch_id} className="grid grid-cols-1 sm:grid-cols-[1fr_8rem_8rem] gap-3 items-start rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2">
            <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200 pt-2" title={locked ? `Still has ${row.current} in stock; sell or adjust it to 0 first` : undefined}>
              <input
                type="checkbox"
                checked={row.stocked}
                disabled={locked}
                onChange={(e) => onChange(row.branch_id, { stocked: e.target.checked })}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              {row.name}
            </label>
            {row.existing ? (
              <p className="text-sm text-gray-600 dark:text-gray-400 pt-2" aria-label={`Quantity at ${row.name}`}>{row.current} in stock</p>
            ) : (
              <Input
                aria-label={`Starting quantity at ${row.name}`}
                type="number"
                min="0"
                step="1"
                value={row.quantity}
                disabled={!row.stocked}
                onChange={(e) => onChange(row.branch_id, { quantity: e.target.value })}
                error={errors[`quantity-${row.branch_id}`]}
              />
            )}
            <Input
              aria-label={`Low-stock level at ${row.name}`}
              type="number"
              min="0"
              step="1"
              value={row.low_stock_threshold}
              disabled={!row.stocked}
              onChange={(e) => onChange(row.branch_id, { low_stock_threshold: e.target.value })}
              error={errors[`threshold-${row.branch_id}`]}
            />
          </div>
        )
      })}
      {errors.stocks && <p className="text-xs text-danger-600">{errors.stocks}</p>}
    </div>
  )
}

export default function ProductFormPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const { branches, branchesLoaded, branchesFailed, reloadBranches } = useBranch()
  // Stock rows as loaded (edit) and as being edited, by branch id
  const [loadedStocks, setLoadedStocks] = useState(null)
  const [stockEdits, setStockEdits] = useState({})
  const isEditing = Boolean(id)
  // /products/new?variantOf=<id> adds a size or flavour to that product
  const [searchParams] = useSearchParams()
  const variantOf = isEditing ? null : searchParams.get('variantOf')
  // The main product when this one is a variant ({ id, name, variant_name }), and this one's own variants
  const [parent, setParent] = useState(null)
  const [variants, setVariants] = useState([])
  const { currency_symbol } = useSettings()
  const { user } = useAuth()
  // Activating/deactivating is ADMIN-only, matching product deletion
  const canToggleActive = user?.role === 'ADMIN'

  const [categories, setCategories] = useState([])
  // null when closed; { name, description } while the New category dialog is open
  const [newCategory, setNewCategory] = useState(null)
  const [newCategoryError, setNewCategoryError] = useState('')
  const [isCreatingCategory, setIsCreatingCategory] = useState(false)
  const [suppliers, setSuppliers] = useState([])
  const [isLoadingProduct, setIsLoadingProduct] = useState(isEditing || Boolean(variantOf))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState({})
  const fileInputRef = useRef(null)

  const [form, setForm] = useState({
    name: '',
    sku: '',
    barcode: '',
    category_id: '',
    supplier_id: '',
    price: '',
    cost_price: '',
    quantity: '0',
    low_stock_threshold: '10',
    is_active: true,
    variant_name: '',
  })
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [imageRemoved, setImageRemoved] = useState(false)

  // Load categories and suppliers in parallel
  useEffect(() => {
    productsService.categories()
      .then((res) => setCategories(res.data?.data || []))
      .catch(() => toast.error('Failed to load categories'))
    api.get('/suppliers', { params: { per_page: 100 } })
      .then((res) => setSuppliers(res.data?.data || []))
      .catch(() => {}) // non-critical — supplier field will just be empty
  }, [])

  // One row per branch this user manages: every open branch for an admin, their own for a manager
  const manageable = user?.role === 'ADMIN' ? branches : branches.filter((b) => b.id === user?.branch?.id)
  const stockRows = manageable.map((b) => {
    const loaded = loadedStocks?.find((r) => r.branch_id === b.id)
    const edits = stockEdits[b.id] || {}
    return {
      branch_id: b.id,
      name: b.name,
      existing: Boolean(loaded),
      current: loaded?.quantity ?? 0,
      // New products start stocked everywhere this user manages; existing ones as they are
      stocked: edits.stocked ?? (isEditing ? Boolean(loaded) : true),
      quantity: edits.quantity ?? '0',
      low_stock_threshold: edits.low_stock_threshold ?? String(loaded?.low_stock_threshold ?? form.low_stock_threshold ?? '10'),
    }
  })
  const editStock = (branchId, change) => setStockEdits((prev) => ({ ...prev, [branchId]: { ...prev[branchId], ...change } }))

  // Load product if editing
  useEffect(() => {
    if (!isEditing) return
    productsService.get(id)
      .then((res) => {
        const p = res.data?.data
        if (!p) { toast.error('Product not found'); navigate('/products'); return }
        setForm({
          name: p.name || '',
          sku: p.sku || '',
          barcode: p.barcode || '',
          category_id: p.category_id || '',
          supplier_id: p.supplier_id || '',
          price: p.price?.toString() || '',
          cost_price: p.cost_price?.toString() || '',
          quantity: p.quantity?.toString() || '0',
          low_stock_threshold: p.low_stock_threshold?.toString() || '10',
          is_active: p.is_active ?? true,
          variant_name: p.variant_name || '',
        })
        setParent(p.parent || null)
        setVariants(p.variants || [])
        setLoadedStocks(p.stocks || [])
        if (p.image_url) setImagePreview(p.image_url)
      })
      .catch(() => { toast.error('Failed to load product'); navigate('/products') })
      .finally(() => setIsLoadingProduct(false))
  }, [id, isEditing, navigate])

  // New variant: start from the main product's details; the cashier-facing name gets the option added
  useEffect(() => {
    if (!variantOf) return
    productsService.get(variantOf)
      .then((res) => {
        const p = res.data?.data
        if (p.parent) { toast.error('Add variants to the main product'); navigate(`/products/new?variantOf=${p.parent.id}`, { replace: true }); return }
        setParent({ id: p.id, name: p.name, variant_name: p.variant_name })
        setForm((prev) => ({
          ...prev,
          name: `${p.name} `,
          category_id: p.category_id || '',
          supplier_id: p.supplier_id || '',
          price: p.price?.toString() || '',
          cost_price: p.cost_price?.toString() || '',
          low_stock_threshold: p.low_stock_threshold?.toString() || '10',
        }))
      })
      .catch(() => { toast.error('Main product not found'); navigate('/products') })
      .finally(() => setIsLoadingProduct(false))
  }, [variantOf, navigate])

  async function handleCreateCategory(e) {
    e.preventDefault()
    if (!newCategory.name.trim()) { setNewCategoryError('Category name is required'); return }
    setIsCreatingCategory(true)
    try {
      const res = await productsService.createCategory({
        name: newCategory.name.trim(),
        description: newCategory.description.trim() || null,
      })
      const created = res.data.data
      setCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setField('category_id', created.id)
      setNewCategory(null)
      toast.success(`Category "${created.name}" created`)
    } catch (err) {
      setNewCategoryError(getFieldErrors(err).name ?? getErrorMessage(err, 'Failed to create category'))
    } finally {
      setIsCreatingCategory(false)
    }
  }

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors((prev) => { const e = { ...prev }; delete e[key]; return e })
  }

  function handleImageChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setErrors((prev) => ({ ...prev, image: 'Please select a valid image file' }))
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, image: 'Image must be smaller than 5 MB' }))
      return
    }
    setImageFile(file)
    setImageRemoved(false)
    setImagePreview(URL.createObjectURL(file))
    setErrors((prev) => { const e = { ...prev }; delete e.image; return e })
  }

  function validate() {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Product name is required'
    if (!form.sku.trim()) errs.sku = 'SKU is required'
    if (!form.category_id) errs.category_id = 'Category is required'
    if (!form.price || parseFloat(form.price) <= 0) errs.price = 'Price must be greater than 0'
    if (form.cost_price && parseFloat(form.cost_price) < 0) errs.cost_price = 'Cost price cannot be negative'
    // A new product has to be sold somewhere
    if (!isEditing && !stockRows.some((r) => r.stocked)) errs.stocks = 'Tick at least one branch that sells this product'
    for (const row of stockRows.filter((r) => r.stocked)) {
      if (!row.existing && !isWholeAtLeastZero(row.quantity)) errs[`quantity-${row.branch_id}`] = 'A whole number, 0 or more'
      if (!isWholeAtLeastZero(row.low_stock_threshold)) errs[`threshold-${row.branch_id}`] = 'A whole number, 0 or more'
    }
    if (parent && !form.variant_name.trim()) errs.variant_name = 'Name the variant, e.g. a size or flavour'
    if (form.variant_name.trim().length > 50) errs.variant_name = 'Variant name must be 50 characters or fewer'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  function stocksPayload() {
    return stockRows
      .filter((r) => r.stocked)
      .map((r) => ({
        branch_id: r.branch_id,
        ...(!r.existing && { quantity: parseInt(r.quantity, 10) }),
        low_stock_threshold: parseInt(r.low_stock_threshold, 10),
      }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!validate()) { toast.error('Please fix the errors below'); return }

    setIsSubmitting(true)
    try {
      let payload

      if (imageFile) {
        // Use FormData for file upload
        payload = new FormData()
        payload.append('name', form.name.trim())
        payload.append('sku', form.sku.trim())
        // Optional fields are always sent: an empty value clears them, as in the JSON branch
        payload.append('barcode', form.barcode.trim())
        payload.append('category_id', form.category_id)
        payload.append('supplier_id', form.supplier_id)
        payload.append('price', form.price)
        payload.append('cost_price', form.cost_price)
        // Starting stock is only set when a branch starts stocking it; later changes go through inventory
        payload.append('stocks', JSON.stringify(stocksPayload()))
        if (canToggleActive) payload.append('is_active', form.is_active ? 'true' : 'false')
        payload.append('variant_name', form.variant_name.trim())
        if (!isEditing && parent) payload.append('parent_id', parent.id)
        payload.append('image', imageFile)
      } else {
        payload = {
          name: form.name.trim(),
          sku: form.sku.trim(),
          barcode: form.barcode.trim() || null,
          category_id: form.category_id,
          supplier_id: form.supplier_id || null,
          price: parseFloat(form.price),
          cost_price: form.cost_price ? parseFloat(form.cost_price) : null,
          stocks: stocksPayload(),
          ...(canToggleActive && { is_active: form.is_active }),
          ...(isEditing && imageRemoved && { image_url: null }),
          variant_name: form.variant_name.trim() || null,
          ...(!isEditing && parent && { parent_id: parent.id }),
        }
      }

      if (isEditing) {
        await productsService.update(id, payload)
        toast.success('Product updated successfully')
      } else {
        await productsService.create(payload)
        toast.success('Product created successfully')
      }

      // A new variant goes back to its main product, to add the next size
      navigate(!isEditing && parent ? `/products/${parent.id}/edit` : '/products')
    } catch (err) {
      const fieldErrors = getFieldErrors(err)
      setErrors(fieldErrors)
      toast.error(Object.keys(fieldErrors).length ? 'Please fix the errors below' : getErrorMessage(err, 'Failed to save product'))
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoadingProduct) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-24">
          <div className="flex items-center gap-3 text-gray-500">
            <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading product…
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-5">
        {/* Page header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/products')}
            aria-label="Go back"
            className="p-2 rounded-full hover:bg-gray-100 text-gray-500 transition"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {isEditing ? (parent ? 'Edit Variant' : 'Edit Product') : parent ? 'Add Variant' : 'Add Product'}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {parent
                ? <>A size or flavour of <Link to={`/products/${parent.id}/edit`} className="text-primary-600 hover:underline">{parent.name}</Link>, with its own SKU, price and stock</>
                : isEditing ? 'Update the product details below' : 'Fill in the details for the new product'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {/* Basic info */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Basic Information</h2>

            <Input
              label="Product Name *"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="e.g. Coca-Cola 500ml"
              error={errors.name}
            />

            {parent && (
              <Input
                label="Variant name *"
                value={form.variant_name}
                onChange={(e) => setField('variant_name', e.target.value)}
                placeholder="e.g. 1.5L, Large, Strawberry"
                error={errors.variant_name}
                maxLength={50}
              />
            )}

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="SKU *"
                value={form.sku}
                onChange={(e) => setField('sku', e.target.value.toUpperCase())}
                placeholder="e.g. BEV-001"
                error={errors.sku}
              />
              <Input
                label="Barcode (EAN)"
                value={form.barcode}
                onChange={(e) => setField('barcode', e.target.value)}
                placeholder="e.g. 6001234567890"
                error={errors.barcode}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="product-category" className="text-sm font-medium text-gray-700 dark:text-gray-300">Category *</label>
                  <button
                    type="button"
                    onClick={() => { setNewCategory({ name: '', description: '' }); setNewCategoryError('') }}
                    className="text-xs font-medium text-primary-600 hover:text-primary-700"
                  >
                    + New category
                  </button>
                </div>
                <select
                  id="product-category"
                  value={form.category_id}
                  onChange={(e) => setField('category_id', e.target.value)}
                  disabled={Boolean(parent)}
                  title={parent ? "A variant is always in its main product's category" : undefined}
                  className={`block w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition bg-white dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700
                    ${errors.category_id ? 'border-danger-500 bg-danger-50' : 'border-gray-300'}`}
                >
                  <option value="">Select a category…</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
                {errors.category_id && <p className="text-xs text-danger-600 mt-1">{errors.category_id}</p>}
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Supplier</label>
                <select
                  value={form.supplier_id}
                  onChange={(e) => setField('supplier_id', e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition bg-white dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">No supplier</option>
                  {suppliers.map((sup) => (
                    <option key={sup.id} value={sup.id}>{sup.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Pricing */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-4 mt-4">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Pricing</h2>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label={`Selling Price (${currency_symbol}) *`}
                type="number"
                min="0.01"
                step="0.01"
                value={form.price}
                onChange={(e) => setField('price', e.target.value)}
                placeholder="0.00"
                error={errors.price}
              />
              <Input
                label={`Cost Price (${currency_symbol})`}
                type="number"
                min="0"
                step="0.01"
                value={form.cost_price}
                onChange={(e) => setField('cost_price', e.target.value)}
                placeholder="0.00 (optional)"
                error={errors.cost_price}
              />
            </div>
          </div>

          {/* Branch stock */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-4 mt-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Stocked at</h2>
              <p className="text-xs text-gray-400 mt-1">
                Tick each branch that sells this product. {isEditing ? 'To change stock that is already there, use the Inventory page.' : ''}
              </p>
            </div>
            <StockedAt rows={stockRows} onChange={editStock} errors={errors} loaded={branchesLoaded} failed={branchesFailed} onRetry={reloadBranches} />
          </div>

          {/* Image upload */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-4 mt-4">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Product Image</h2>

            <div className="flex items-start gap-4">
              {/* Preview */}
              <div className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-200 overflow-hidden flex-shrink-0 flex items-center justify-center bg-gray-50">
                {imagePreview ? (
                  <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                )}
              </div>

              <div className="flex-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {imagePreview ? 'Change Image' : 'Upload Image'}
                </Button>
                {imagePreview && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-2 text-danger-500 hover:text-danger-700"
                    onClick={() => { setImageFile(null); setImagePreview(null); setImageRemoved(true); if (fileInputRef.current) fileInputRef.current.value = '' }}
                  >
                    Remove
                  </Button>
                )}
                <p className="text-xs text-gray-400 mt-2">JPG, PNG, or WebP. Max 5 MB.</p>
                {errors.image && <p className="text-xs text-danger-600 mt-1">{errors.image}</p>}
              </div>
            </div>
          </div>

          {/* Variants: only main products have them */}
          {isEditing && !parent && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Variants</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Sizes or flavours, each with its own SKU, barcode, price and stock. The till offers them together.</p>
                </div>
                <Button type="button" variant="secondary" size="sm" onClick={() => navigate(`/products/new?variantOf=${id}`)}>
                  + Add variant
                </Button>
              </div>
              {variants.length > 0 && (
                <>
                  <Input
                    label="This product's option name"
                    value={form.variant_name}
                    onChange={(e) => setField('variant_name', e.target.value)}
                    placeholder="e.g. 500ml (shown next to its variants)"
                    error={errors.variant_name}
                    maxLength={50}
                  />
                  <ul className="divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-100 dark:border-gray-800">
                    {variants.map((v) => (
                      <li key={v.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <Link to={`/products/${v.id}/edit`} className="font-medium text-primary-600 hover:underline">{v.variant_name}</Link>
                        <span className="text-gray-500 dark:text-gray-400">
                          {v.sku} · {currency_symbol} {Number(v.price).toFixed(2)} · {v.quantity} in stock{v.is_active ? '' : ' · inactive'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {/* Status (admin only) */}
          {canToggleActive && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 mt-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Active Status</h2>
                <p className="text-xs text-gray-400 mt-0.5">Inactive products won't appear in the POS</p>
              </div>
              <button
                type="button"
                onClick={() => setField('is_active', !form.is_active)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${form.is_active ? 'bg-primary-600' : 'bg-gray-200'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${form.is_active ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
            </div>
          </div>
          )}

          {/* Form actions */}
          <div className="flex gap-3 justify-end mt-5">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate('/products')}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isSubmitting} disabled={!branchesLoaded || branchesFailed}>
              {isEditing ? 'Save Changes' : 'Create Product'}
            </Button>
          </div>
        </form>
      </div>

      <Modal isOpen={newCategory !== null} onClose={() => setNewCategory(null)} title="New category" size="sm">
        {newCategory && (
          <form onSubmit={handleCreateCategory} className="space-y-4" noValidate>
            <Input
              label="Name *"
              value={newCategory.name}
              onChange={(e) => { setNewCategory((c) => ({ ...c, name: e.target.value })); setNewCategoryError('') }}
              error={newCategoryError}
              placeholder="e.g. Frozen Foods"
              autoFocus
            />
            <Input
              label="Description"
              value={newCategory.description}
              onChange={(e) => setNewCategory((c) => ({ ...c, description: e.target.value }))}
              placeholder="Optional"
            />
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setNewCategory(null)} disabled={isCreatingCategory}>Cancel</Button>
              <Button type="submit" isLoading={isCreatingCategory}>Create category</Button>
            </div>
          </form>
        )}
      </Modal>
    </DashboardLayout>
  )
}
