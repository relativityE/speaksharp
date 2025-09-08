// vite.config.mjs - UPDATED CONFIGURATION
/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Base configuration for both Vitest and Playwright
const baseConfig = {
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
};

// Vitest-specific configuration
const vitestConfig = {
  test: {
    testTimeout: 15000,
    hookTimeout: 10000,
    globals: true,
    // Switch to jsdom to provide a browser-like environment for component tests
    environment: 'jsdom',
    clearMocks: false,
    restoreMocks: false,
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
    // Exclude Playwright E2E tests from the unit test run
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/tests/**', // This correctly excludes all E2E tests
      '**/supabase/functions/**',
    ],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Remove forced serial execution to enable parallelism
    // pool: 'threads',
    // poolOptions: {
    //   threads: {
    //     maxThreads: 1,
    //     minThreads: 1
    //   }
    // }
  }
};

export default defineConfig(({ command, mode }) => {
  // If we are running the dev server for Playwright, we only need the base config.
  // The 'test' mode is used by the `dev:test` script.
  if (command === 'serve' && mode === 'test') {
    return baseConfig;
  }

  // For all other commands (like `vitest run`), include the test config.
  return {
    ...baseConfig,
    ...vitestConfig,
  };
});
