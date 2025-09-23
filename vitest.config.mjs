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
    setupFiles: 'tests/unit/setup.ts',
    globalSetup: './src/test/unit-global-setup.ts',
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 5000,
    reporters: ['verbose'],  // Simplified - remove json reporter for now
    threads: false,
    maxThreads: 4,
    minThreads: 1,
    watch: false,
    env: {
      VITE_TEST_MODE: 'true',
      NODE_ENV: 'test'
    },
    deps: {
      inline: ["@xenova/transformers"],
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "sharp": path.resolve(__dirname, "./src/test/mocks/sharp.ts"),
      '@xenova/transformers': path.resolve(__dirname, './__mocks__/transformers.ts'),
    },
  },
  define: {
    TEST_MODE: JSON.stringify(process.env.VITE_TEST_MODE === 'true'),
  }
});
