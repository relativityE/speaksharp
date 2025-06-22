import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom', // Switch from jsdom - uses less memory
    setupFiles: ['./src/test/setup.js'],
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true, // Prevents memory accumulation across tests
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
