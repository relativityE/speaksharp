// vitest.config.js - Configured for Stability based on user feedback
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    // Using 'forks' with a single worker to force serial execution.
    // This is a workaround for severe memory leak issues in the test suite.
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 1,
        minForks: 1,
      }
    },
    maxConcurrency: 1,

    // Ensure mocks are cleared and restored between each test to prevent state leakage.
    clearMocks: true,
    restoreMocks: true,

    // Increased timeout to prevent premature failures on slow tests.
    testTimeout: 30000,
    hookTimeout: 5000,
    teardownTimeout: 3000,

    // Environment setup
    environment: 'happy-dom',
    setupFiles: ['src/test/setup.js'],

    // Performance optimizations
    isolate: false,
    passWithNoTests: true,
    bail: 1, // Stop on first failure for faster feedback

    // Exclude problematic files
    exclude: [
      '**/node_modules/**',
      '**/playwright-tests/**',
      '**/dist/**',
      '**/*.e2e.*'
    ],

    // Module resolution optimizations
    alias: {
      '@': resolve(__dirname, './src'),
      '@xenova/transformers': resolve(__dirname, 'src/test/mocks/transformers.js'),
      'sharp': resolve(__dirname, 'src/test/mocks/sharp.js')
    },

    globals: true,
    reporter: process.env.CI ? 'json' : 'basic'
  },

  // Vite optimizations for test mode
  optimizeDeps: {
    exclude: ['@xenova/transformers', 'sharp']
  },

  build: {
    target: 'node14'
  }
})
