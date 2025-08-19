// vitest.config.js
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig(({ mode }) => {
  const isVitest = process.env.VITEST;

  return {
    plugins: [react()],
    test: {
        // Switch to forks pool to avoid thread pool issues
        pool: 'forks', // or 'vmForks'

        // Explicit timeout configuration
        testTimeout: 15000,
        hookTimeout: 15000,
        teardownTimeout: 15000,

        // Environment setup
        environment: 'jsdom',
        setupFiles: ['src/test/setup.js'],

        // Debugging options
        bail: 1, // Stop on first failure
        reporter: 'verbose',

        // Force exit to prevent hanging
        forceRerunTriggers: ['**/package.json/**', '**/vitest.config.*/**'],

        // Global settings
        globals: true,

        // Pool options for better resource management
        poolOptions: {
          forks: {
            singleFork: true, // Use single fork for debugging
            maxWorkers: 1
          }
        }
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        ...(isVitest
          ? { sharp: path.resolve(__dirname, '__mocks__/sharp.js') }
          : {}),
      },
    },
  }
});
