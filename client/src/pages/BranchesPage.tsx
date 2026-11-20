import { useState, useEffect, useCallback, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Modal } from '../components/Modal'
import { Table } from '../components/Table'
import { Badge } from '../components/Badge'
import { branchesService } from '../services/branches'
import { useBranch } from '../hooks/useBranch'
import { getErrorMessage, getFieldErrors } from '../utils/apiErrors'
import { defineColumns } from '../utils/tableColumns'
import type { BranchRef } from '../types'

interface BranchForm {
  name: string
  code: string
  address: string
  phone: string
}

const EMPTY: BranchForm = { name: '', code: '', address: '', phone: '' }

/** The branch being edited, or {} for a new one */
type EditingBranch = BranchRef | { id?: undefined }

export interface BranchModalProps {
  branch: BranchRef | null
  onClose: () => void
  onSaved: () => void
}

function BranchModal({ branch, onClose, onSaved }: BranchModalProps) {
  const editing = Boolean(branch)
  const [form, setForm] = useState<BranchForm>(branch ? { name: branch.name, code: branch.code, address: branch.address ?? '', phone: branch.phone ?? '' } : EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)
  const set = (key: keyof BranchForm, value: string) => setForm((f) => ({ ...f, [key]: value }))

  function validate() {
    const errs: Record<string, string> = {}
    if (form.name.trim().length < 2) errs.name = 'Give the branch a name (at least 2 characters)'
    if (!/^[A-Z]{2,6}$/.test(form.code.trim())) errs.code = 'Use 2–6 capital letters, e.g. KSI'
    return errs
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const errs = validate()
    setErrors(errs)
    if (Object.keys(errs).length) return
    const payload = { name: form.name.trim(), code: form.code.trim(), address: form.address.trim() || null, phone: form.phone.trim() || null }
    setIsSaving(true)
    try {
      const res = branch ? await branchesService.update(branch.id, payload) : await branchesService.create(payload)
      toast.success(res.data.message ?? 'Branch saved')
      onSaved()
    } catch (err) {
      const fieldErrors = getFieldErrors(err)
      setErrors(fieldErrors)
      if (!Object.keys(fieldErrors).length) toast.error(getErrorMessage(err, 'Failed to save the branch'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={branch ? `Edit ${branch.name}` : 'New branch'} size="md">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Input label="Name" value={form.name} maxLength={80} onChange={(e) => set('name', e.target.value)} error={errors.name} placeholder="e.g. Accra Mall" />
        <Input
          label="Short code"
          value={form.code}
          maxLength={6}
          onChange={(e) => set('code', e.target.value.toUpperCase())}
          error={errors.code}
          placeholder="e.g. ACC"
        />
        <Input label="Address (printed on receipts)" value={form.address} maxLength={200} onChange={(e) => set('address', e.target.value)} error={errors.address} />
        <Input label="Phone (printed on receipts)" value={form.phone} maxLength={30} onChange={(e) => set('phone', e.target.value)} error={errors.phone} />
        <p className="text-xs text-gray-500 dark:text-gray-400">Left blank, receipts use the store address and phone from Settings.</p>
        <div className="flex gap-3 pt-1">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button type="submit" className="flex-1" isLoading={isSaving}>{editing ? 'Save changes' : 'Create branch'}</Button>
        </div>
      </form>
    </Modal>
  )
}

export default function BranchesPage() {
  const { reloadBranches } = useBranch()
  const [branches, setBranches] = useState<BranchRef[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editing, setEditing] = useState<EditingBranch | null>(null)
  const [closing, setClosing] = useState<BranchRef | null>(null)
  const [isClosing, setIsClosing] = useState(false)

  const fetchBranches = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await branchesService.list()
      setBranches(res.data.data || [])
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load branches'))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBranches()
  }, [fetchBranches])

  const changed = () => {
    fetchBranches()
    reloadBranches()
  }

  async function setOpen(branch: BranchRef, is_active: boolean) {
    setIsClosing(true)
    try {
      await branchesService.update(branch.id, { is_active })
      toast.success(is_active ? `${branch.name} reopened` : `${branch.name} closed`)
      setClosing(null)
      changed()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update the branch'))
    } finally {
      setIsClosing(false)
    }
  }

  const columns = defineColumns<BranchRef>()([
    { key: 'name', label: 'Branch', sortable: true },
    { key: 'code', label: 'Code', sortable: true, render: (v) => <span className="font-mono text-xs">{v}</span> },
    { key: 'address', label: 'Address', render: (v) => v || <span className="text-gray-400">Store address</span> },
    { key: 'phone', label: 'Phone', render: (v) => v || <span className="text-gray-400">Store phone</span> },
    {
      key: 'is_active',
      label: 'Status',
      sortable: true,
      render: (v) => <Badge variant={v ? 'success' : 'default'}>{v ? 'Open' : 'Closed'}</Badge>,
    },
    {
      key: 'actions',
      label: '',
      render: (_, row) => (
        <div className="flex justify-end gap-3 text-xs font-semibold" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="text-primary-600 dark:text-primary-400 hover:underline" onClick={() => setEditing(row)}>Edit</button>
          {row.is_active ? (
            <button type="button" className="text-danger-600 hover:underline" onClick={() => setClosing(row)}>Close</button>
          ) : (
            <button type="button" className="text-gray-500 hover:underline" onClick={() => setOpen(row, true)}>Reopen</button>
          )}
        </div>
      ),
    },
  ])

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Branches</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">The shops in the chain. Each keeps its own stock, staff, shifts and sales</p>
          </div>
          <Button onClick={() => setEditing({})}>New branch</Button>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <Table
            columns={columns}
            data={branches}
            isLoading={isLoading}
            onRowClick={(row) => setEditing(row)}
            emptyMessage="No branches yet. Create one to start."
          />
        </div>
      </div>

      {editing && (
        <BranchModal
          branch={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            changed()
          }}
        />
      )}

      <Modal isOpen={Boolean(closing)} onClose={() => setClosing(null)} title={`Close ${closing?.name ?? 'branch'}?`} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Its staff will be signed out and can't sign in, and nothing new can be sold or stocked there. Its history stays in
            reports, and you can reopen it later.
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setClosing(null)} disabled={isClosing}>Cancel</Button>
            <Button variant="danger" className="flex-1" isLoading={isClosing} onClick={() => closing && setOpen(closing, false)}>Close branch</Button>
          </div>
        </div>
      </Modal>
    </DashboardLayout>
  )
}
