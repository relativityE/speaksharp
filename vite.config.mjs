/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      // Exclude the problematic file from the React plugin's transformations.
      // This file uses a Vite-specific '?url' import that seems to crash
      // the dev server when processed by the React plugin. Since the file
      // contains no JSX, it's safe to exclude it.
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
    // CRITICAL: Run each test file in complete isolation
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 1,
        minForks: 1,
        isolate: true,
        // Kill and restart worker after each test file
        singleFork: true,
      }
    },
    // Force sequential execution to prevent memory buildup
    fileParallelism: false,
    // Reduce timeouts to catch hanging tests faster
    testTimeout: 10000,
    hookTimeout: 5000,
    // Enable garbage collection
    globals: true,
    environment: 'happy-dom',

    // Explicit cache directory
    cache: {
      dir: '/tmp/vitest_cache',
    },

    // Good to keep test runs isolated from local noise
    clearMocks: true,
    restoreMocks: true,
    setupFiles: ['./src/test/setup.tsx'],
    // Run coverage only on successful tests
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
    // [JULES] Explicitly provide aliases to the test environment
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@xenova/transformers": path.resolve(__dirname, "./__mocks__/transformers.js"),
    },
  }
})
