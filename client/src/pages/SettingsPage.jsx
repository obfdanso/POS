import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { settingsService } from '../services/settings'
import { useSettings } from '../context/SettingsContext'

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToggleSwitch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900
        ${checked ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200
          ${checked ? 'translate-x-6' : 'translate-x-1'}`}
      />
    </button>
  )
}

function SectionCard({ icon, title, description, children }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-start gap-3">
        {icon && (
          <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center text-primary-600 dark:text-primary-400">
            {icon}
          </div>
        )}
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          {description && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
          )}
        </div>
      </div>
      <div className="px-6 py-5 divide-y divide-gray-100 dark:divide-gray-800">
        {children}
      </div>
    </div>
  )
}

function FieldRow({ label, hint, error, half, children }) {
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className={`flex flex-col ${half ? 'sm:flex-row sm:items-start sm:gap-6' : 'gap-2'}`}>
        <div className={half ? 'sm:w-64 flex-shrink-0' : ''}>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</p>
          {hint && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 leading-snug">{hint}</p>}
        </div>
        <div className={half ? 'flex-1' : ''}>{children}</div>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}

function ToggleRow({ label, hint, checked, onChange, disabled, children }) {
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</p>
          {hint && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 leading-snug">{hint}</p>}
        </div>
        <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} />
      </div>
      {checked && children && (
        <div className="mt-4 pl-4 border-l-2 border-primary-200 dark:border-primary-800">
          {children}
        </div>
      )}
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="py-4 animate-pulse">
      <div className="flex items-start gap-6">
        <div className="w-48">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-1" />
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full" />
        </div>
        <div className="flex-1 h-10 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const StoreIcon = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 22V12h6v10" />
  </svg>
)

const TaxIcon = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
  </svg>
)

const LoyaltyIcon = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
  </svg>
)

const ReceiptIcon = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
  </svg>
)

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { refreshSettings } = useSettings()

  const [settings, setSettings] = useState({
    store_name: '',
    store_address: '',
    store_phone: '',
    currency_symbol: 'GH₵',
    tax_rate: '0',
    loyalty_points_rate: '10',
    receipt_footer: 'Thank you for your business!',
  })

  const [taxEnabled, setTaxEnabled] = useState(false)
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    settingsService
      .get()
      .then((res) => {
        const s = res.data?.data || {}
        setSettings((prev) => ({ ...prev, ...s }))
        const taxRate = parseFloat(s.tax_rate)
        setTaxEnabled(!isNaN(taxRate) && taxRate > 0)
        const loyaltyRate = parseFloat(s.loyalty_points_rate)
        setLoyaltyEnabled(isNaN(loyaltyRate) ? true : loyaltyRate > 0)
      })
      .catch(() => toast.error('Failed to load settings'))
      .finally(() => setIsLoading(false))
  }, [])

  function handleChange(key, value) {
    setSettings((prev) => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  function handleTaxToggle(enabled) {
    setTaxEnabled(enabled)
    if (!enabled) {
      setSettings((prev) => ({ ...prev, tax_rate: '0' }))
      setErrors((prev) => ({ ...prev, tax_rate: undefined }))
    } else {
      setSettings((prev) => ({
        ...prev,
        tax_rate: parseFloat(prev.tax_rate) > 0 ? prev.tax_rate : '12.5',
      }))
    }
  }

  function handleLoyaltyToggle(enabled) {
    setLoyaltyEnabled(enabled)
    if (!enabled) {
      setSettings((prev) => ({ ...prev, loyalty_points_rate: '0' }))
      setErrors((prev) => ({ ...prev, loyalty_points_rate: undefined }))
    } else {
      setSettings((prev) => ({
        ...prev,
        loyalty_points_rate: parseFloat(prev.loyalty_points_rate) > 0 ? prev.loyalty_points_rate : '10',
      }))
    }
  }

  function validate() {
    const errs = {}
    if (!settings.store_name?.trim()) errs.store_name = 'Store name is required'
    if (!settings.currency_symbol?.trim()) errs.currency_symbol = 'Currency symbol is required'
    if (taxEnabled) {
      const taxRate = parseFloat(settings.tax_rate)
      if (isNaN(taxRate) || taxRate <= 0 || taxRate > 100) {
        errs.tax_rate = 'Tax rate must be between 0.01% and 100%'
      }
    }
    if (loyaltyEnabled) {
      const loyaltyRate = parseFloat(settings.loyalty_points_rate)
      if (isNaN(loyaltyRate) || loyaltyRate < 1) {
        errs.loyalty_points_rate = 'Loyalty rate must be at least 1'
      }
    }
    return errs
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    setErrors({})
    setIsSaving(true)
    const payload = {
      ...settings,
      tax_rate: taxEnabled ? settings.tax_rate : '0',
      loyalty_points_rate: loyaltyEnabled ? settings.loyalty_points_rate : '0',
    }
    try {
      const res = await settingsService.update(payload)
      const saved = res.data?.data || payload
      setSettings(saved)
      // Refresh the global settings context so currency updates everywhere instantly
      refreshSettings()
      toast.success('Settings saved')
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage your store configuration and preferences.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* ── Store Information ─────────────────────────── */}
          <SectionCard
            icon={StoreIcon}
            title="Store Information"
            description="Details that appear on receipts and throughout the app."
          >
            {isLoading ? (
              [1, 2, 3, 4].map((i) => <SkeletonRow key={i} />)
            ) : (
              <>
                <FieldRow label="Store Name" hint="Your business name" error={errors.store_name} half>
                  <Input
                    value={settings.store_name ?? ''}
                    onChange={(e) => handleChange('store_name', e.target.value)}
                    placeholder="My POS Store"
                    error={!!errors.store_name}
                  />
                </FieldRow>

                <FieldRow label="Store Address" hint="Shown on printed receipts" half>
                  <Input
                    value={settings.store_address ?? ''}
                    onChange={(e) => handleChange('store_address', e.target.value)}
                    placeholder="123 Main St, Accra, Ghana"
                  />
                </FieldRow>

                <FieldRow label="Store Phone" hint="Customer contact number" half>
                  <Input
                    value={settings.store_phone ?? ''}
                    onChange={(e) => handleChange('store_phone', e.target.value)}
                    placeholder="0XX-XXX-XXXX"
                  />
                </FieldRow>

                <FieldRow label="Currency Symbol" hint="Symbol displayed next to prices" error={errors.currency_symbol} half>
                  <Input
                    value={settings.currency_symbol ?? ''}
                    onChange={(e) => handleChange('currency_symbol', e.target.value)}
                    placeholder="GH₵"
                    error={!!errors.currency_symbol}
                  />
                </FieldRow>
              </>
            )}
          </SectionCard>

          {/* ── Tax Settings ──────────────────────────────── */}
          <SectionCard
            icon={TaxIcon}
            title="Tax Settings"
            description="Configure how sales tax is applied to transactions."
          >
            {isLoading ? (
              <SkeletonRow />
            ) : (
              <ToggleRow
                label="Enable Sales Tax"
                hint="When on, tax is automatically calculated and added to every sale."
                checked={taxEnabled}
                onChange={handleTaxToggle}
              >
                <FieldRow label="Tax Rate" hint="Percentage applied on each sale" error={errors.tax_rate} half>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <Input
                        type="number"
                        value={settings.tax_rate ?? ''}
                        onChange={(e) => handleChange('tax_rate', e.target.value)}
                        placeholder="e.g. 12.5"
                        min={0.01}
                        max={100}
                        step={0.01}
                        error={!!errors.tax_rate}
                      />
                    </div>
                    <span className="text-sm text-gray-500 dark:text-gray-400 flex-shrink-0">%</span>
                  </div>
                </FieldRow>
              </ToggleRow>
            )}
          </SectionCard>

          {/* ── Customer & Loyalty ────────────────────────── */}
          <SectionCard
            icon={LoyaltyIcon}
            title="Customer & Loyalty"
            description="Reward returning customers with loyalty points on every purchase."
          >
            {isLoading ? (
              <SkeletonRow />
            ) : (
              <ToggleRow
                label="Enable Loyalty Points"
                hint="Customers earn 1 point for every set amount spent. Points accumulate automatically."
                checked={loyaltyEnabled}
                onChange={handleLoyaltyToggle}
              >
                <FieldRow
                  label="Spend per Point"
                  hint="How much a customer must spend to earn 1 loyalty point."
                  error={errors.loyalty_points_rate}
                  half
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500 dark:text-gray-400 flex-shrink-0">
                      {settings.currency_symbol || 'GH₵'}
                    </span>
                    <div className="flex-1">
                      <Input
                        type="number"
                        value={settings.loyalty_points_rate ?? ''}
                        onChange={(e) => handleChange('loyalty_points_rate', e.target.value)}
                        placeholder="10"
                        min={1}
                        step={1}
                        error={!!errors.loyalty_points_rate}
                      />
                    </div>
                    <span className="text-sm text-gray-500 dark:text-gray-400 flex-shrink-0">per point</span>
                  </div>
                </FieldRow>
              </ToggleRow>
            )}
          </SectionCard>

          {/* ── Receipt Settings ──────────────────────────── */}
          <SectionCard
            icon={ReceiptIcon}
            title="Receipt Settings"
            description="Customise what appears on printed receipts."
          >
            {isLoading ? (
              <SkeletonRow />
            ) : (
              <FieldRow label="Footer Message" hint="A short message printed at the bottom of every receipt." half>
                <Input
                  value={settings.receipt_footer ?? ''}
                  onChange={(e) => handleChange('receipt_footer', e.target.value)}
                  placeholder="Thank you for your business!"
                />
              </FieldRow>
            )}
          </SectionCard>

          {/* ── Save ─────────────────────────────────────── */}
          <div className="flex justify-end pb-2">
            <Button
              type="submit"
              variant="primary"
              isLoading={isSaving}
              disabled={isLoading || isSaving}
            >
              Save Settings
            </Button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  )
}
