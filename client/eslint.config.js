import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// React rules shared by the JavaScript and TypeScript sources
const reactConfigs = [js.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite]

const languageOptions = {
  ecmaVersion: 2020,
  globals: globals.browser,
  parserOptions: {
    ecmaVersion: 'latest',
    ecmaFeatures: { jsx: true },
    sourceType: 'module',
  },
}

// Context modules export their context and hook alongside the provider
const onlyExportComponents = [
  'error',
  { allowExportNames: ['AuthContext', 'CartContext', 'SettingsContext', 'ThemeContext', 'useCart', 'useSettings', 'useTheme'] },
]

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: reactConfigs,
    languageOptions,
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'react-refresh/only-export-components': onlyExportComponents,
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...reactConfigs, tseslint.configs.recommended],
    languageOptions,
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'react-refresh/only-export-components': onlyExportComponents,
    },
  },
])
