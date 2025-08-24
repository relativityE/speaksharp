import js from '@eslint/js'
import globals from 'globals'
import vitest from '@vitest/eslint-plugin'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist'] },
  {
    files: ['__mocks__/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: ['src/test/**/*.js', 'src/__tests__/**/*.jsx', 'vitest.config.js', 'vite.config.js'],
    plugins: {
      vitest,
    },
    rules: {
      ...vitest.configs.recommended.rules,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...vitest.environments.env.globals,
      },
    },
  },
]
