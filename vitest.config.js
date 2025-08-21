import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    // CRITICAL: This fixes the memory leak
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      }
    },
    // Force isolation
    isolate: true,
    // Manual cleanup
    setupFiles: ['./src/setupTests.js'],
    // Fix reporter deprecation
    reporters: [
      ['default', { summary: false }]
    ]
  }
})
