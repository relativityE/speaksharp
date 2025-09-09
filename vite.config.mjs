// vite.config.mjs - SIMPLIFIED STATIC CONFIGURATION
/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Export a single, static configuration object to avoid conditional logic issues.
export default defineConfig({
  plugins: [
    react({
      exclude: /audioUtils\.impl\.js$/,
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    include: ['@supabase/supabase-js'],
  },
  test: {
    // These settings are now applied unconditionally for Vitest.
    globals: true,
    environment: 'jsdom', // Use jsdom for all unit/component tests to provide a browser-like environment.
    setupFiles: ['./src/test/setup.tsx'],
    testTimeout: 15000,
    hookTimeout: 10000,
    clearMocks: false,
    restoreMocks: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.test.*',
        '**/*.spec.*'
      ]
    },
    // Explicitly exclude Playwright E2E tests and other non-unit test directories.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/tests/**', // Exclude all E2E tests
      '**/supabase/functions/**',
    ],
  },
});
