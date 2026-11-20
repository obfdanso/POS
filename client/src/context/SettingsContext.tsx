import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { settingsService } from '../services/settings'
import { useAuth } from '../hooks/useAuth'
import { setDefaultCurrencySymbol } from '../utils/formatCurrency'
import type { Settings } from '../types'

export type Theme = 'light' | 'dark' | 'system'

export interface SettingsContextValue extends Settings {
  /** Reloads the settings; resolves to them, or null if they couldn't be fetched (does nothing without a provider) */
  refreshSettings: () => Promise<Settings | null> | void
}

export interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const DEFAULT_SETTINGS: Settings = {
  store_name: 'QuickMart',
  store_address: '27 Kwame Nkrumah Ave, Kumasi, Ghana',
  store_phone: '032-204-1234',
  tax_rate: '0',
  loyalty_points_rate: '10',
  loyalty_point_value: '0',
  currency_symbol: 'GH₵',
  receipt_footer: 'Thank you for choosing QuickMart!',
}

export const SettingsContext = createContext<SettingsContextValue>({ ...DEFAULT_SETTINGS, refreshSettings: () => {} })
export const ThemeContext = createContext<ThemeContextValue>({ theme: 'system', setTheme: () => {} })

function applyTheme(theme: Theme): void {
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

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth()
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)

  const [theme, setThemeState] = useState<Theme>(() => {
    // Only setTheme writes this key
    return (localStorage.getItem('pos-theme') as Theme | null) || 'system'
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

  function setTheme(newTheme: Theme): void {
    localStorage.setItem('pos-theme', newTheme)
    setThemeState(newTheme)
    applyTheme(newTheme)
  }

  // Resolves to the loaded settings, or null if they couldn't be fetched
  const loadSettings = useCallback((): Promise<Settings | null> => {
    return settingsService
      .get()
      .then((res) => {
        const data = res.data?.data
        if (data) {
          // Update the formatter before re-rendering so every price uses the new symbol
          setDefaultCurrencySymbol(data.currency_symbol)
          setSettings((prev) => ({ ...prev, ...data }))
        }
        return data ?? null
      })
      .catch(() => {
        // Fall back to defaults silently
        return null
      })
  }, [])

  // GET /settings requires auth, so (re)load whenever a user signs in.
  // Without this, settings stay at defaults after a fresh login (e.g. tax 0%)
  // and the cart total disagrees with what the server charges.
  useEffect(() => {
    if (isAuthenticated) loadSettings()
  }, [isAuthenticated, loadSettings])

  const contextValue: SettingsContextValue = {
    ...settings,
    refreshSettings: loadSettings,
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <SettingsContext.Provider value={contextValue}>{children}</SettingsContext.Provider>
    </ThemeContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext)
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}
