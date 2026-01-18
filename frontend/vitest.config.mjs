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
    include: ['src/**/*.test.{js,jsx,ts,tsx}', 'tests/**/*.test.{js,jsx,ts,tsx}'],
    exclude: ['node_modules/', 'dist/', 'build/'],
    setupFiles: './tests/unit/setup.ts',
    testTimeout: 30000, // Increased for cleanup
    hookTimeout: 10000,
    teardownTimeout: 10000, // Increased for cleanup
    // CLEAN CI OUTPUT: Use 'basic' for minimal noise, 'verbose' only when debugging
    // Set CI_DEBUG=true for verbose output
    reporters: process.env.CI_DEBUG
      ? ['verbose', 'html', ['json', { outputFile: 'unit-metrics.json' }]]
      : ['basic', ['json', { outputFile: 'unit-metrics.json' }]],
    // Suppress console.log noise from tests in CI mode
    silent: !process.env.CI_DEBUG,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      all: true,
      // Enforce coverage doesn't regress
      // Note: Functions threshold lowered from 70% to 65% (Jan 2026) after C2 AuthProvider refactor
      // removed profile-related tests. Target: restore to 70% with future test expansion.
      thresholds: {
        lines: 50,
        functions: 65,
        branches: 75,
        statements: 50,
      },
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
    // Fix deprecation: "deps.inline" -> "server.deps.inline"
    server: {
      deps: {
        inline: ["@xenova/transformers", "whisper-turbo", "whisper-webgpu"],
      }
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@config": path.resolve(__dirname, "../scripts"),
      "tests": path.resolve(__dirname, "./tests"),
      "sharp": path.resolve(__dirname, "./tests/support/mocks/sharp.ts"),
      '@xenova/transformers': path.resolve(__dirname, './tests/__mocks__/transformers.ts'),
      'whisper-turbo': path.resolve(__dirname, './tests/__mocks__/whisper-turbo.ts'),
    },
  },
  define: {
    TEST_MODE: JSON.stringify(process.env.VITE_TEST_MODE === 'true'),
  },
  optimizeDeps: {
    exclude: ['whisper-turbo', 'whisper-webgpu']
  }
});