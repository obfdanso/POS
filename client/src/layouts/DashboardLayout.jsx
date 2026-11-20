import { Fragment, useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../context/SettingsContext'
import { useCart } from '../context/CartContext'
import { useBranch } from '../hooks/useBranch'
import { BranchSwitcher } from '../components/BranchSwitcher'
import { Modal } from '../components/Modal'
import toast from 'react-hot-toast'

const icons = {
  branches: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 10h.01M15 10h.01" />
    </svg>
  ),
  promotions: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5a1.99 1.99 0 011.41.59l7 7a2 2 0 010 2.82l-7 7a2 2 0 01-2.82 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
    </svg>
  ),
  orders: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10m10 0h2m-2 0H9m10 0h1a1 1 0 001-1v-3.65a1 1 0 00-.22-.624l-3.48-4.35A1 1 0 0016.52 6H13" />
    </svg>
  ),
  shifts: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  home: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  ),
  mySales: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  ),
  profile: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  pos: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  products: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  inventory: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  ),
  customers: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  dashboard: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10-10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zm0 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
    </svg>
  ),
  reports: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  users: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
  settings: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
}

const roleBadge = {
  ADMIN: 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400',
  MANAGER: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400',
  CASHIER: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400',
}

function NavItem({ to, icon, label, end = false }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-1.5 px-1.5 2xl:px-2.5 h-full text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
          isActive
            ? 'border-teal-600 text-teal-600 dark:text-teal-400 dark:border-teal-400'
            : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
        }`
      }
    >
      <span className="hidden 2xl:block w-4 h-4 flex-shrink-0">{icon}</span>
      <span>{label}</span>
    </NavLink>
  )
}

const ADMIN_LINKS = [
  { to: '/branches', icon: 'branches', label: 'Branches' },
  { to: '/users', icon: 'users', label: 'Users' },
  { to: '/settings', icon: 'settings', label: 'Settings' },
]

// The admin-only pages, grouped under one header item so the bar fits on a 1280px screen
function AdminMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const { pathname } = useLocation()
  const isActive = ADMIN_LINKS.some((l) => pathname.startsWith(l.to))

  useEffect(() => {
    if (!open) return undefined
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative flex items-stretch">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 px-2 xl:px-2.5 h-full text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
          isActive
            ? 'border-teal-600 text-teal-600 dark:text-teal-400 dark:border-teal-400'
            : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
        }`}
      >
        Admin
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg py-1 z-40">
          {ADMIN_LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              onClick={() => setOpen(false)}
              className={({ isActive: active }) =>
                `flex items-center gap-2 px-3 py-2 text-sm ${
                  active ? 'text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/30' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`
              }
            >
              <span className="w-4 h-4 flex-shrink-0">{icons[l.icon]}</span>
              {l.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

function MobileNavItem({ to, icon, label, end = false, onClick }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
          isActive
            ? 'bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400'
            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100'
        }`
      }
    >
      <span className="w-5 h-5 flex-shrink-0">{icon}</span>
      <span>{label}</span>
    </NavLink>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  function cycle() {
    if (theme === 'light') setTheme('dark')
    else if (theme === 'dark') setTheme('system')
    else setTheme('light')
  }

  return (
    <button
      onClick={cycle}
      title={`Theme: ${theme}`}
      aria-label="Toggle dark mode"
      className="p-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 transition"
    >
      <span className="w-5 h-5 block">
        {isDark ? (
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M18.364 17.657l-.707-.707M6.343 6.343l-.707-.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        ) : (
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        )}
      </span>
    </button>
  )
}

export function DashboardLayout({ children, noPad = false }) {
  const { user, logout } = useAuth()
  const { branchId } = useBranch()
  const { clearCart } = useCart()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showLogoutModal, setShowLogoutModal] = useState(false)

  async function handleLogout() {
    setShowLogoutModal(false)
    clearCart()
    await logout()
    navigate('/login')
    toast.success('Signed out successfully')
  }

  const isAdmin = user?.role === 'ADMIN'
  const isManager = user?.role === 'MANAGER' || isAdmin
  const isCashier = user?.role === 'CASHIER'
  const closeMobile = () => setMobileOpen(false)

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* ── Top Navigation Bar ── */}
      <header className="sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-4 flex items-stretch h-16 gap-2">

          {/* Logo */}
          <div className="flex items-center gap-2.5 flex-shrink-0 pr-2 xl:pr-4">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" className="w-8 h-8 flex-shrink-0">
              <rect width="64" height="64" rx="14" ry="14" fill="#0d9488"/>
              <circle cx="31" cy="27" r="12" fill="none" stroke="white" strokeWidth="5"/>
              <line x1="39" y1="35" x2="47" y2="44" stroke="white" strokeWidth="5" strokeLinecap="round"/>
              <circle cx="22" cy="55" r="4" fill="white"/>
              <circle cx="38" cy="55" r="4" fill="white"/>
            </svg>
            <span className="text-sm font-bold text-gray-900 dark:text-gray-100 hidden sm:block lg:hidden 2xl:block">QuickMart</span>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-stretch flex-1 overflow-x-auto gap-0.5">
            {/* Cashier nav */}
            {isCashier && (
              <>
                <NavItem to="/cashier/dashboard" icon={icons.home} label="Home" end />
                <NavItem to="/pos" icon={icons.pos} label="New Sale" end />
                <div className="w-px bg-gray-200 dark:bg-gray-700 mx-1 2xl:mx-2 my-3 flex-shrink-0" />
                <NavItem to="/cashier/sales" icon={icons.mySales} label="My Sales" />
                <NavItem to="/cashier/customers" icon={icons.customers} label="Customer Lookup" />
                <div className="w-px bg-gray-200 dark:bg-gray-700 mx-1 2xl:mx-2 my-3 flex-shrink-0" />
                <NavItem to="/cashier/profile" icon={icons.profile} label="My Profile" />
              </>
            )}

            {/* Manager / Admin nav */}
            {isManager && (
              <>
                <NavItem to="/dashboard" icon={icons.dashboard} label="Overview" end />
                <NavItem to="/pos" icon={icons.pos} label="New Sale" end />
                <div className="w-px bg-gray-200 dark:bg-gray-700 mx-1 2xl:mx-2 my-3 flex-shrink-0" />
                <NavItem to="/products" icon={icons.products} label="Products" />
                <NavItem to="/inventory" icon={icons.inventory} label="Inventory" />
                <NavItem to="/purchase-orders" icon={icons.orders} label="Orders" />
                <NavItem to="/promotions" icon={icons.promotions} label="Promos" />
                <NavItem to="/customers" icon={icons.customers} label="Customers" />
                <div className="w-px bg-gray-200 dark:bg-gray-700 mx-1 2xl:mx-2 my-3 flex-shrink-0" />
                <NavItem to="/sales" icon={icons.mySales} label="Sales" />
                <NavItem to="/shifts" icon={icons.shifts} label="Shifts" />
                <NavItem to="/reports" icon={icons.reports} label="Reports" />
              </>
            )}

          </nav>
          {isAdmin && (
            <div className="hidden lg:flex items-stretch">
              <div className="w-px bg-gray-200 dark:bg-gray-700 mx-1 my-3 flex-shrink-0" />
              <AdminMenu />
            </div>
          )}

          {/* Right-side controls */}
          <div className="flex items-center gap-1 ml-auto">
            <BranchSwitcher className="hidden md:inline-flex mr-1" compact />
            <ThemeToggle />

            {/* User info */}
            <div className="hidden sm:flex items-center gap-2.5 pl-3 ml-1 border-l border-gray-200 dark:border-gray-700 h-10 self-center">
              <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 flex items-center justify-center text-sm font-bold flex-shrink-0">
                {user?.role?.[0]?.toUpperCase()}
              </div>
              <div className="hidden 2xl:block leading-tight">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 leading-none mb-0.5">{user?.role ? user.role[0] + user.role.slice(1).toLowerCase() : '—'}</p>
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${roleBadge[user?.role]}`}>{user?.role}</span>
              </div>
            </div>

            {/* Logout */}
            <button
              onClick={() => setShowLogoutModal(true)}
              title="Sign out"
              aria-label="Sign out"
              className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition ml-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Open menu"
              className="lg:hidden p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition"
            >
              {mobileOpen ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {mobileOpen && (
          <div className="lg:hidden border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 space-y-1">
            {/* Mobile user info */}
            <div className="flex items-center gap-3 px-3 py-2 mb-2 pb-3 border-b border-gray-100 dark:border-gray-800">
              <div className="w-9 h-9 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 flex items-center justify-center text-sm font-bold flex-shrink-0">
                {user?.role?.[0]?.toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {user?.role ? user.role[0] + user.role.slice(1).toLowerCase() : '—'}
                </p>
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${roleBadge[user?.role]}`}>{user?.role}</span>
              </div>
            </div>

            <div className="px-3 pb-2 md:hidden">
              <BranchSwitcher />
            </div>

            {/* Cashier mobile nav */}
            {isCashier && (
              <>
                <MobileNavItem to="/cashier/dashboard" icon={icons.home} label="Home" end onClick={closeMobile} />
                <MobileNavItem to="/pos" icon={icons.pos} label="New Sale" end onClick={closeMobile} />
                <div className="h-px bg-gray-100 dark:bg-gray-800 my-1" />
                <MobileNavItem to="/cashier/sales" icon={icons.mySales} label="My Sales" onClick={closeMobile} />
                <MobileNavItem to="/cashier/customers" icon={icons.customers} label="Customer Lookup" onClick={closeMobile} />
                <div className="h-px bg-gray-100 dark:bg-gray-800 my-1" />
                <MobileNavItem to="/cashier/profile" icon={icons.profile} label="My Profile" onClick={closeMobile} />
              </>
            )}

            {/* Manager / Admin mobile nav */}
            {isManager && <MobileNavItem to="/dashboard" icon={icons.dashboard} label="Overview" end onClick={closeMobile} />}
            {isManager && <MobileNavItem to="/pos" icon={icons.pos} label="New Sale" end onClick={closeMobile} />}

            {isManager && (
              <>
                <div className="h-px bg-gray-100 dark:bg-gray-800 my-1" />
                <MobileNavItem to="/products" icon={icons.products} label="Products" onClick={closeMobile} />
                <MobileNavItem to="/inventory" icon={icons.inventory} label="Inventory" onClick={closeMobile} />
                <MobileNavItem to="/purchase-orders" icon={icons.orders} label="Purchase Orders" onClick={closeMobile} />
                <MobileNavItem to="/promotions" icon={icons.promotions} label="Promotions" onClick={closeMobile} />
                <MobileNavItem to="/customers" icon={icons.customers} label="Customers" onClick={closeMobile} />
                <div className="h-px bg-gray-100 dark:bg-gray-800 my-1" />
                <MobileNavItem to="/sales" icon={icons.mySales} label="Sales" onClick={closeMobile} />
                <MobileNavItem to="/shifts" icon={icons.shifts} label="Shifts" onClick={closeMobile} />
                <MobileNavItem to="/reports" icon={icons.reports} label="Reports" onClick={closeMobile} />
              </>
            )}

            {isAdmin && (
              <>
                <div className="h-px bg-gray-100 dark:bg-gray-800 my-1" />
                <MobileNavItem to="/branches" icon={icons.branches} label="Branches" onClick={closeMobile} />
                <MobileNavItem to="/users" icon={icons.users} label="Users" onClick={closeMobile} />
                <MobileNavItem to="/settings" icon={icons.settings} label="Settings" onClick={closeMobile} />
              </>
            )}
          </div>
        )}
      </header>

      {/* Page content */}
      <main className="flex-1 min-h-0 flex flex-col">
        {/* Keyed by branch: switching branch reloads the page's data for the new branch */}
        <Fragment key={branchId ?? 'all'}>
          {noPad ? children : (
            <div className="max-w-7xl mx-auto px-6 py-6 w-full">
              {children}
            </div>
          )}
        </Fragment>
      </main>

      {/* Logout confirmation modal */}
      <Modal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        title="Sign Out"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Are you sure you want to sign out of your account?
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowLogoutModal(false)}
              className="px-4 py-2 text-sm font-medium rounded-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              Cancel
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm font-medium rounded-full bg-danger-600 hover:bg-danger-700 text-white transition focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-danger-500"
            >
              Sign Out
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
