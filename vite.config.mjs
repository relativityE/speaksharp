import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
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
        'playwright-report/'
      ]
    }
  },
  build: {
    sourcemap: true,
    outDir: 'dist',
    rollupOptions: { output: { manualChunks: undefined } }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      ...(process.env.PLAYWRIGHT_TEST && {
        '@stripe/stripe-js': path.resolve(__dirname, 'tests/mocks/stripe.js'),
        '@stripe/react-stripe-js': path.resolve(__dirname, 'tests/mocks/stripe.js'),
      }),
    },
  }
}));
