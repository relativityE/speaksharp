/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss({
      content: [
        './pages/**/*.{js,jsx}',
        './components/**/*.{js,jsx}',
        './app/**/*.{js,jsx}',
        './src/**/*.{js,jsx}',
        './index.html'
      ],
    }),
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // [JULES] Mock the transformers library at the bundler level to prevent OOM errors in tests
      "@xenova/transformers": path.resolve(__dirname, "./__mocks__/transformers.js"),
    },
  },
  optimizeDeps: {
    include: ['@supabase/supabase-js'],
  },
  test: {
    environment: 'happy-dom',   // lighter than jsdom
    globals: true,              // gives expect, describe, etc.
    // [JULES] Use forks to run tests in a separate process, per user suggestion.
    // This provides better isolation and prevents memory leaks between test files,
    // which was causing the 'heap out of memory' error.
    pool: 'threads',
    poolOptions: {
      threads: {
        maxThreads: 1,
        minThreads: 1,
      },
    },
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'v8',           // fast native coverage
      reporter: ['text', 'json', 'html']
    },
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/playwright-tests/**',
    ],
    // [JULES] Explicitly provide aliases to the test environment
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@xenova/transformers": path.resolve(__dirname, "./__mocks__/transformers.js"),
    },
  }
})
