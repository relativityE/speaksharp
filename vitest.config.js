import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache', 'playwright-tests'],
    isolate: true,
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 15000,
    hookTimeout: 10000
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
