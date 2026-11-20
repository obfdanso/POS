import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from './context/AuthContext'
import { BranchProvider } from './context/BranchContext'
import { CartProvider } from './context/CartContext'
import { SettingsProvider } from './context/SettingsContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { OfflineBanner } from './components/OfflineBanner'
import { initErrorReporting } from './utils/errorReporting'
import App from './App'
import './index.css'

// Optional: report crashes to Sentry when VITE_SENTRY_DSN is set at build time
initErrorReporting()

// index.html always has it; createRoot would throw without it anyway
const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Missing #root element')

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <BranchProvider>
        <SettingsProvider>
          <CartProvider>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
            <OfflineBanner />
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 3000,
                style: {
                  borderRadius: '8px',
                  fontSize: '14px',
                },
              }}
            />
          </CartProvider>
        </SettingsProvider>
        </BranchProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
)

// Installable app with screens that load offline. Production only: in development the service
// worker's cache would serve stale code over Vite's hot reload
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Not supported here (e.g. plain HTTP on a non-local address); the app works the same without it
    })
  })
}
