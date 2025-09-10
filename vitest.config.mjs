// vitest.config.mjs
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/*.test.{js,jsx,ts,tsx}'],
    exclude: ['node_modules/', 'dist/', 'build/', 'tests/'],
    setupFiles: ['./src/test-setup.js'],
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 5000,
    reporters: ['verbose'],  // Simplified - remove json reporter for now
    threads: true,
    maxThreads: 4,
    minThreads: 1,
    watch: false,
    env: {
      VITE_TEST_MODE: 'true',
      NODE_ENV: 'test'
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    TEST_MODE: JSON.stringify(process.env.VITE_TEST_MODE === 'true'),
  }
});
