import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
    watch: {
      ignored: [
        'test-results/',
        'coverage/',
        '**/*.log',
        'docs/PRD.md'
      ]
    }
  },
  build: {
    sourcemap: true,
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: undefined,
      }
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Conditionally mock Stripe modules only when Playwright is running
      ...(process.env.PLAYWRIGHT_TEST && {
        '@stripe/stripe-js': path.resolve(__dirname, 'tests/mocks/stripe.js'),
        '@stripe/react-stripe-js': path.resolve(__dirname, 'tests/mocks/stripe.js'),
      }),
    },
  }
}));
