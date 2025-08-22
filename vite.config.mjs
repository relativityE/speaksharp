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
    },
  },
  optimizeDeps: {
    include: ['@supabase/supabase-js'],
  },
  test: {
    environment: 'happy-dom',   // lighter than jsdom
    globals: true,              // gives expect, describe, etc.
    isolate: true,              // prevents memory bleed between tests
    setupFiles: './src/test/setup.ts',
    threads: true,              // run tests in workers
    maxThreads: 4,              // cap to avoid OOM
    minThreads: 2,
    coverage: {
      provider: 'v8',           // fast native coverage
      reporter: ['text', 'json', 'html']
    },
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/playwright-tests/**',
    ],
  }
})
