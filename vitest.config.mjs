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
    testTimeout: 30000, // Increased for cleanup
    hookTimeout: 10000,
    teardownTimeout: 10000, // Increased for cleanup
    reporters: ['verbose', 'html', ['json', { outputFile: 'unit-metrics.json' }]],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './test-results/coverage',
      all: true,
    },

    // CRITICAL: Run each test file in its own isolated process to prevent memory leaks.
    pool: 'forks',
    poolOptions: {
      forks: {
        isolate: true, // Ensure tests do not share state
        singleFork: false // Use multiple forks (processes)
      }
    },

    // Memory management
    maxConcurrency: 1,
    fileParallelism: false,

    watch: false,
    env: {
      VITE_TEST_MODE: 'true',
      NODE_ENV: 'test',
      // Force garbage collection
      NODE_OPTIONS: '--max-old-space-size=2048'
    },
    deps: {
      inline: ["@xenova/transformers", "whisper-turbo", "whisper-webgpu"],
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "sharp": path.resolve(__dirname, "./src/test/mocks/sharp.ts"),
      '@xenova/transformers': path.resolve(__dirname, './__mocks__/transformers.ts'),
      'whisper-turbo': path.resolve(__dirname, './__mocks__/whisper-turbo.ts'),
    },
  },
  define: {
    TEST_MODE: JSON.stringify(process.env.VITE_TEST_MODE === 'true'),
  },
  optimizeDeps: {
    exclude: ['whisper-turbo', 'whisper-webgpu']
  }
});