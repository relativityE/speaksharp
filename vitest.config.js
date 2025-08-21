import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    // CRITICAL: Disable worker threads completely
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      }
    },
    // Run tests sequentially
    sequence: {
      concurrent: false
    },
    fileParallelism: false,
    // Setup cleanup
    setupFiles: ['./src/test/setup.js'],
    // Increase timeouts
    testTimeout: 60000,
    hookTimeout: 60000
  }
})
