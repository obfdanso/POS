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
  overrides: [
    {
      files: ['*.ts'],
      parser: '@typescript-eslint/parser',
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      plugins: ['@typescript-eslint'],
      extends: ['plugin:@typescript-eslint/recommended'],
      rules: {
        // TypeScript reports undefined names itself, and knows about type-only globals
        'no-undef': 'off',
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        '@typescript-eslint/no-explicit-any': 'error',
        // Declaration merging (e.g. augmenting Express.Request) needs a namespace
        '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      },
    },
  ],
}
