import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

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
  // The build tool config files that stay JavaScript
  {
    files: ['*.js'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite, tseslint.configs.recommended],
    languageOptions,
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'react-refresh/only-export-components': onlyExportComponents,
    },
  },
])
