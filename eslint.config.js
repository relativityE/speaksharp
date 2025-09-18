import tseslint from 'typescript-eslint';
import js from '@eslint/js';
import globals from 'globals';
import vitest from '@vitest/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },

  // Base configs
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // General App Code
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': 'warn', // TODO: Re-enable this rule
      'no-unused-vars': 'off', // Disable base rule to prefer TS version
      '@typescript-eslint/no-explicit-any': 'warn', // TODO: Remove this warning and fix all 'any' types
      '@typescript-eslint/no-empty-object-type': 'warn', // TODO: Re-enable this rule
      '@typescript-eslint/no-require-imports': 'warn', // TODO: Re-enable this rule
      'no-empty': 'warn', // TODO: Re-enable this rule
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },

  // Config for Mocks
  {
    files: ['__mocks__/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Config for scripts
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Config for Test files
  {
    files: ['**/*.{test,spec}.{js,jsx,ts,tsx}'],
    plugins: {
      vitest,
    },
    rules: {
      ...vitest.configs.recommended.rules,
    },
    languageOptions: {
      globals: {
        ...globals.node,
        ...vitest.environments.env.globals,
      },
    },
  },

  // Config for project-level config files
  {
    files: ['*.{js,cjs,mjs,ts}'],
     languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  }
);
