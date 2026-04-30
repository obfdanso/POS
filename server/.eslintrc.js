module.exports = {
  env: {
    node: true,
    es2022: true,
    jest: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'commonjs',
  },
  rules: {
    // Code quality
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['info', 'warn', 'error'] }],
    'no-var': 'error',
    'prefer-const': 'error',
    'eqeqeq': ['error', 'always'],

    // Style (Prettier handles most formatting, these are logic-level)
    'no-duplicate-imports': 'error',
    'no-throw-literal': 'error',
    'no-return-await': 'warn',

    // Node-specific
    'no-process-exit': 'warn',
    'handle-callback-err': 'warn',
  },
}
