// vite.config.mjs - UPDATED CONFIGURATION
/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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
    // SIMPLIFIED: Remove complex pool configuration
    testTimeout: 15000,
    hookTimeout: 10000,
    globals: true,
    environment: 'happy-dom',
    clearMocks: false, // CRITICAL: Don't clear our persistent mocks
    restoreMocks: false, // CRITICAL: Don't restore our persistent mocks
    setupFiles: ['./src/test/setup.tsx'],
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
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/tests/**',
      '**/supabase/functions/**',
    ],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Force sequential test execution to prevent race conditions
    pool: 'threads',
    poolOptions: {
      threads: {
        maxThreads: 1,
        minThreads: 1
      }
    }
  }
})
