import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import LoginPage from './pages/LoginPage'
import POSPage from './pages/POSPage'
import ProductsPage from './pages/ProductsPage'
import ProductFormPage from './pages/ProductFormPage'
import InventoryPage from './pages/InventoryPage'
import CustomersPage from './pages/CustomersPage'
import CustomerDetailPage from './pages/CustomerDetailPage'
import DashboardPage from './pages/DashboardPage'
import ReportsPage from './pages/ReportsPage'
import SalesPage from './pages/SalesPage'
import UsersPage from './pages/UsersPage'
import SettingsPage from './pages/SettingsPage'
import CashierDashboardPage from './pages/CashierDashboardPage'
import CashierSalesPage from './pages/CashierSalesPage'
import CashierProfilePage from './pages/CashierProfilePage'
import CashierCustomerLookupPage from './pages/CashierCustomerLookupPage'

const STAFF_ROLES = ['ADMIN', 'MANAGER', 'CASHIER']

function getDefaultPath(role) {
  if (role === 'ADMIN' || role === 'MANAGER') return '/dashboard'
  if (role === 'CASHIER') return '/cashier/dashboard'
  return '/login'
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <svg className="animate-spin h-8 w-8 text-primary-600" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-sm text-gray-500">Loading...</span>
      </div>
    </div>
  )
}

function ProtectedRoute({ children, roles }) {
  const { isAuthenticated, isLoading, user } = useAuth()

  if (isLoading) return <LoadingScreen />
  if (!isAuthenticated) return <Navigate to="/login" replace />

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={getDefaultPath(user.role)} replace />
  }

  return children
}

function PublicRoute({ children }) {
  const { isAuthenticated, isLoading, user } = useAuth()

  if (isLoading) return <LoadingScreen />
  if (isAuthenticated) {
    return <Navigate to={getDefaultPath(user.role)} replace />
  }

  return children
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />

      {/* ── Cashier routes ── */}
      <Route
        path="/cashier/dashboard"
        element={
          <ProtectedRoute roles={['CASHIER']}>
            <CashierDashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/cashier/sales"
        element={
          <ProtectedRoute roles={['CASHIER']}>
            <CashierSalesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/cashier/customers"
        element={
          <ProtectedRoute roles={['CASHIER']}>
            <CashierCustomerLookupPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/cashier/customers/:id"
        element={
          <ProtectedRoute roles={['CASHIER']}>
            <CustomerDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/cashier/profile"
        element={
          <ProtectedRoute roles={['CASHIER']}>
            <CashierProfilePage />
          </ProtectedRoute>
        }
      />

      {/* ── Staff routes ── */}
      <Route
        path="/pos"
        element={
          <ProtectedRoute roles={STAFF_ROLES}>
            <POSPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/products"
        element={
          <ProtectedRoute roles={['MANAGER', 'ADMIN']}>
            <ProductsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/products/new"
        element={
          <ProtectedRoute roles={['MANAGER', 'ADMIN']}>
            <ProductFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/products/:id/edit"
        element={
          <ProtectedRoute roles={['MANAGER', 'ADMIN']}>
            <ProductFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory"
        element={
          <ProtectedRoute roles={['MANAGER', 'ADMIN']}>
            <InventoryPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/customers"
        element={
          <ProtectedRoute roles={['MANAGER', 'ADMIN']}>
            <CustomersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/customers/:id"
        element={
          <ProtectedRoute roles={['MANAGER', 'ADMIN']}>
            <CustomerDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute roles={['MANAGER', 'ADMIN']}>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/sales"
        element={
          <ProtectedRoute roles={['MANAGER', 'ADMIN']}>
            <SalesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute roles={['MANAGER', 'ADMIN']}>
            <ReportsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/users"
        element={
          <ProtectedRoute roles={['ADMIN']}>
            <UsersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute roles={['ADMIN']}>
            <SettingsPage />
          </ProtectedRoute>
        }
      />

      {/* Redirects */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
