import { useState, useEffect } from 'react'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import api from '../services/api'

// ─── Sub-components (mirrors SettingsPage style) ──────────────────────────────

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
      <div className="px-6 py-5 divide-y divide-gray-100 dark:divide-gray-800">{children}</div>
    </div>
  )
}

function FieldRow({ label, hint, error, children }) {
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-col sm:flex-row sm:items-start sm:gap-6">
        <div className="sm:w-52 flex-shrink-0">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</p>
          {hint && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 leading-snug">{hint}</p>}
        </div>
        <div className="flex-1 mt-1.5 sm:mt-0">{children}</div>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}

function ReadOnlyValue({ value }) {
  return (
    <div className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-600 dark:text-gray-400 select-none">
      {value || '—'}
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const UserIcon = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
)

const LockIcon = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
  </svg>
)

const roleBadgeStyle = {
  ADMIN:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  MANAGER: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  CASHIER: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CashierProfilePage() {
  const { user, refreshUser } = useAuth()

  // Profile form — synced from user on load
  const [profileForm, setProfileForm] = useState({ full_name: '', email: '' })
  const [profileErrors, setProfileErrors] = useState({})
  const [savingProfile, setSavingProfile] = useState(false)

  // Password form
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '', confirm_password: '' })
  const [pwErrors, setPwErrors] = useState({})
  const [savingPw, setSavingPw] = useState(false)

  useEffect(() => {
    if (user) {
      setProfileForm({ full_name: user.full_name || '', email: user.email || '' })
    }
  }, [user])

  // ── Profile handlers ──────────────────────────────────────────────────────

  function handleProfileChange(e) {
    const { name, value } = e.target
    setProfileForm((prev) => ({ ...prev, [name]: value }))
    if (profileErrors[name]) setProfileErrors((prev) => ({ ...prev, [name]: '' }))
  }

  function validateProfile() {
    const errs = {}
    if (profileForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileForm.email)) {
      errs.email = 'Invalid email address'
    }
    return errs
  }

  async function handleSaveProfile(e) {
    e.preventDefault()
    const errs = validateProfile()
    if (Object.keys(errs).length) { setProfileErrors(errs); return }
    setProfileErrors({})
    setSavingProfile(true)
    try {
      await api.put('/auth/profile', {
        full_name: profileForm.full_name.trim(),
        email: profileForm.email.trim(),
      })
      await refreshUser()
      toast.success('Profile updated successfully')
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to update profile')
    } finally {
      setSavingProfile(false)
    }
  }

  // ── Password handlers ─────────────────────────────────────────────────────

  function handlePwChange(e) {
    const { name, value } = e.target
    setPwForm((prev) => ({ ...prev, [name]: value }))
    if (pwErrors[name]) setPwErrors((prev) => ({ ...prev, [name]: '' }))
  }

  function validatePw() {
    const errs = {}
    if (!pwForm.current_password) errs.current_password = 'Required'
    if (!pwForm.new_password || pwForm.new_password.length < 6) errs.new_password = 'At least 6 characters'
    if (pwForm.new_password !== pwForm.confirm_password) errs.confirm_password = 'Passwords do not match'
    return errs
  }

  async function handleChangePassword(e) {
    e.preventDefault()
    const errs = validatePw()
    if (Object.keys(errs).length) { setPwErrors(errs); return }
    setPwErrors({})
    setSavingPw(true)
    try {
      await api.post('/auth/change-password', {
        current_password: pwForm.current_password,
        new_password: pwForm.new_password,
      })
      toast.success('Password changed successfully')
      setPwForm({ current_password: '', new_password: '', confirm_password: '' })
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to change password')
    } finally {
      setSavingPw(false)
    }
  }

  const avatarInitial = user?.full_name?.[0]?.toUpperCase() || user?.role?.[0]?.toUpperCase() || '?'
  const roleLabel = user?.role ? user.role[0] + user.role.slice(1).toLowerCase() : ''

  const createdAt = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-GH', { year: 'numeric', month: 'long', day: 'numeric' })
    : null

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-5">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">My Profile</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage your account information and password.
          </p>
        </div>

        {/* ── Account Information ───────────────────────────────── */}
        <SectionCard
          icon={UserIcon}
          title="Account Information"
          description="Update your display name and email address."
        >
          {/* Avatar row */}
          <div className="pb-5">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 flex items-center justify-center text-xl font-bold flex-shrink-0">
                {avatarInitial}
              </div>
              <div>
                <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{roleLabel}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadgeStyle[user?.role] || ''}`}>
                  {user?.role}
                </span>
              </div>
            </div>
          </div>

          <form onSubmit={handleSaveProfile} className="divide-y divide-gray-100 dark:divide-gray-800">
            {/* Full Name */}
            <FieldRow
              label="Full Name"
              hint="Your display name across the app"
              error={profileErrors.full_name}
            >
              <input
                type="text"
                name="full_name"
                value={profileForm.full_name}
                onChange={handleProfileChange}
                placeholder="Enter your full name"
                className={`w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 transition
                  bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                  ${profileErrors.full_name ? 'border-red-400 focus:ring-red-400' : 'border-gray-300 dark:border-gray-700'}`}
              />
            </FieldRow>

            {/* Email */}
            <FieldRow
              label="Email"
              hint="Contact email for your account"
              error={profileErrors.email}
            >
              <input
                type="email"
                name="email"
                value={profileForm.email}
                onChange={handleProfileChange}
                placeholder="Enter your email address"
                className={`w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 transition
                  bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                  ${profileErrors.email ? 'border-red-400 focus:ring-red-400' : 'border-gray-300 dark:border-gray-700'}`}
              />
            </FieldRow>

            {/* Username — read only */}
            <FieldRow label="Username" hint="Cannot be changed">
              <ReadOnlyValue value={user?.username} />
            </FieldRow>

            {/* Role — read only */}
            <FieldRow label="Role" hint="Assigned by an administrator">
              <ReadOnlyValue value={user?.role} />
            </FieldRow>

            {/* Account Created — read only */}
            <FieldRow label="Member Since">
              <ReadOnlyValue value={createdAt} />
            </FieldRow>

            {/* Save */}
            <div className="pt-4 last:pb-0 flex justify-end">
              <button
                type="submit"
                disabled={savingProfile}
                className="px-6 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-300 text-white text-sm font-medium rounded-full transition focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
              >
                {savingProfile ? 'Saving…' : 'Save Profile'}
              </button>
            </div>
          </form>
        </SectionCard>

        {/* ── Change Password ───────────────────────────────────── */}
        <SectionCard
          icon={LockIcon}
          title="Change Password"
          description="Choose a strong password of at least 6 characters."
        >
          <form onSubmit={handleChangePassword} className="divide-y divide-gray-100 dark:divide-gray-800">
            {[
              { name: 'current_password', label: 'Current Password', hint: 'Your existing password' },
              { name: 'new_password',     label: 'New Password',     hint: 'Minimum 6 characters' },
              { name: 'confirm_password', label: 'Confirm Password', hint: 'Must match new password' },
            ].map(({ name, label, hint }) => (
              <FieldRow key={name} label={label} hint={hint} error={pwErrors[name]}>
                <input
                  type="password"
                  name={name}
                  value={pwForm[name]}
                  onChange={handlePwChange}
                  autoComplete="new-password"
                  className={`w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 transition
                    bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                    ${pwErrors[name] ? 'border-red-400 focus:ring-red-400' : 'border-gray-300 dark:border-gray-700'}`}
                />
              </FieldRow>
            ))}

            <div className="pt-4 last:pb-0 flex justify-end">
              <button
                type="submit"
                disabled={savingPw}
                className="px-6 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-300 text-white text-sm font-medium rounded-full transition focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
              >
                {savingPw ? 'Saving…' : 'Save Password'}
              </button>
            </div>
          </form>
        </SectionCard>

      </div>
    </DashboardLayout>
  )
}
