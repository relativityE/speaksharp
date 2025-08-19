// vitest.config.js - Optimized for Performance
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    // CRITICAL: Use forks pool to prevent thread pool deadlock
    pool: 'forks',

    // Aggressive timeout controls
    testTimeout: 10000,      // 10 seconds max per test
    hookTimeout: 5000,       // 5 seconds for setup/teardown
    teardownTimeout: 3000,   // 3 seconds for cleanup

    // Environment setup
    environment: 'happy-dom',
    setupFiles: ['src/test/setup.js'],

    // Performance optimizations
    isolate: false,          // Share context between tests (faster)
    passWithNoTests: true,   // Don't fail on empty test suites
    bail: 1,                 // Stop on first failure for faster feedback

    // Resource management
    poolOptions: {
      forks: {
        singleFork: true,    // Use single process (more stable)
        maxWorkers: 1,       // Limit to 1 worker
        minWorkers: 1
      }
    },

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

    // Globals for better performance
    globals: true,

    // Reporter optimization
    reporter: process.env.CI ? 'json' : 'basic'
  },

  // Vite optimizations for test mode
  optimizeDeps: {
    exclude: ['@xenova/transformers', 'sharp']
  },

  build: {
    target: 'node14' // Simpler target for tests
  }
})
