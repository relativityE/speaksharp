import tseslint from 'typescript-eslint';
import js from '@eslint/js';
import globals from 'globals';
import vitest from '@vitest/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report/', 'test-results/', 'html/', 'public/', 'backend/supabase/migrations/', 'backend/supabase/.temp/', 'tests/global-teardown.js'] },

  // Base configs
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // General App Code
  {
    files: ['frontend/src/**/*.{js,jsx,ts,tsx}'],
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
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-unused-vars': 'off', // Disable base rule to prefer TS version
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-empty-object-type': 'error',
      '@typescript-eslint/no-require-imports': 'error',
      'no-empty': 'error',
      'react-refresh/only-export-components': [
        'warn',  // Downgrade to warning - this is a dev-time optimization hint, not a critical error
        {
          allowConstantExport: true,
          // Allow common patterns: context exports, hooks, variant exports (CVA)
          allowExportNames: ['AuthContext', 'useAuthProvider', 'alertVariants', 'toastVariants'],
        },
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

  // Config for Test helper/setup files
  {
    files: ['tests/**/*.{js,ts}'],
    rules: {
      // Allow @ts-nocheck in the specific case of the E2E helper, which must be pure JS.
      '@typescript-eslint/ban-ts-comment': 'off',
    },
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // ⚠️ E2E Test Anti-Pattern Detection
  //
  // RULE: Catches usage of page.goto() which breaks MSW mocks in authenticated tests.
  //
  // ✅ ALLOWED (helpers.ts excluded):
  //    - page.goto('/') for INITIAL navigation BEFORE auth
  //    - page.goto('/sign-in') for public routes
  //
  // ❌ FORBIDDEN (triggers warning):
  //    - page.goto('/analytics') AFTER programmaticLogin() - breaks MSW context
  //    - page.goto('/session') AFTER programmaticLogin() - breaks mock session
  //
  // USE navigateToRoute(page, '/path') instead for protected routes after login.
  {
    files: ['tests/e2e/**/*.{ts,spec.ts}'],
    ignores: ['tests/e2e/helpers.ts'], // helpers.ts has legitimate page.goto() for initial navigation
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector: "CallExpression[callee.object.name='page'][callee.property.name='goto']",
          message: '⚠️ Do NOT use page.goto() after programmaticLogin! Use navigateToRoute(page, "/path") instead. page.goto() causes full page reload that destroys MSW context. See tests/e2e/helpers.ts for correct pattern.',
        },
      ],
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
      'vitest/no-commented-out-tests': 'error',
    },
    languageOptions: {
      globals: {
        ...globals.node,
        ...vitest.environments.env.globals,
      },
    },
  },

  // Config for Deno Edge Functions
  // RATIONALE: Edge Functions run in the Deno runtime, not Node.js.
  // 1. We include 'backend/supabase/functions/**/*.ts' to catch syntax errors during CI.
  // 2. We define 'Deno' as a global variable to prevent "undefined variable" lint errors 
  //    when using Deno-specific APIs like Deno.serve or Deno.env.
  {
    files: ['backend/supabase/functions/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        Deno: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // Edge Functions often handle generic JSON payloads
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    }
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