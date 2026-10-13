import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { settingsService } from '../services/settings'
import { useAuth } from '../hooks/useAuth'
import { setDefaultCurrencySymbol } from '../utils/formatCurrency'

const DEFAULT_SETTINGS = {
  store_name: 'QuickMart',
  store_address: '27 Kwame Nkrumah Ave, Kumasi, Ghana',
  store_phone: '032-204-1234',
  tax_rate: '0',
  loyalty_points_rate: '10',
  currency_symbol: 'GH₵',
  receipt_footer: 'Thank you for choosing QuickMart!',
}

export const SettingsContext = createContext({ ...DEFAULT_SETTINGS, refreshSettings: () => {} })
export const ThemeContext = createContext({ theme: 'system', setTheme: () => {} })

function applyTheme(theme) {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else if (theme === 'light') {
    root.classList.remove('dark')
  } else {
    // system
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    if (prefersDark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }
}

export function SettingsProvider({ children }) {
  const { isAuthenticated } = useAuth()
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)

  const [theme, setThemeState] = useState(() => {
    return localStorage.getItem('pos-theme') || 'system'
  })

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  function setTheme(newTheme) {
    localStorage.setItem('pos-theme', newTheme)
    setThemeState(newTheme)
    applyTheme(newTheme)
  }

  const loadSettings = useCallback(() => {
    settingsService
      .get()
      .then((res) => {
        const data = res.data?.data
        if (data) {
          // Update the formatter before re-rendering so every price uses the new symbol
          setDefaultCurrencySymbol(data.currency_symbol)
          setSettings((prev) => ({ ...prev, ...data }))
        }
      })
      .catch(() => {
        // Fall back to defaults silently
      })
  }, [])

  // GET /settings requires auth, so (re)load whenever a user signs in.
  // Without this, settings stay at defaults after a fresh login (e.g. tax 0%)
  // and the cart total disagrees with what the server charges.
  useEffect(() => {
    if (isAuthenticated) loadSettings()
  }, [isAuthenticated, loadSettings])

  const contextValue = {
    ...settings,
    refreshSettings: loadSettings,
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <SettingsContext.Provider value={contextValue}>{children}</SettingsContext.Provider>
    </ThemeContext.Provider>
  )
}

export function useSettings() {
  return useContext(SettingsContext)
}

export function useTheme() {
  return useContext(ThemeContext)
}
