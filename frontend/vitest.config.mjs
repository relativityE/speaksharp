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
    root: path.resolve(__dirname, '..'),
    include: [
      'frontend/src/**/*.test.{js,jsx,ts,tsx}',
      'frontend/tests/**/*.test.{js,jsx,ts,tsx}',
      'tests/**/*.test.{js,jsx,ts,tsx}'
    ],
    exclude: ['node_modules/', 'dist/', 'build/'],
    setupFiles: [
      path.resolve(__dirname, './tests/unit/setup.ts')
    ],
    testTimeout: 30000,
    hookTimeout: 10000,
    teardownTimeout: 15000,
    reporters: ['default'],
    // Suppress console.log noise from tests in CI mode
    silent: !process.env.CI_DEBUG,
    coverage: {
      enabled: false,
    },


    // ✅ KEY CHANGE: Use maxForks, NOT singleFork
    // On CI: 1 fork (sequential, low memory)
    // Locally: 3 forks (parallel, faster)
    // ✅ SOLUTION: Process Isolation
    // Each test file runs in its own process, ensuring fresh React/Zustand state.
    pool: 'forks',
    poolOptions: {
      forks: {
        isolate: true,
        maxForks: process.env.CI === 'true' ? 1 : 3,
        execArgv: ['--max-old-space-size=4096'] // 4GB per fork
      }
    },

    // Memory management
    watch: false,
    env: {
      VITE_TEST_MODE: 'true',
      NODE_ENV: 'test',
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
      "@shared": path.resolve(__dirname, "../backend/supabase/functions/_shared"),
      "@config": path.resolve(__dirname, "../scripts"),
      "@test-utils": path.resolve(__dirname, "./tests/support/test-utils"),
      "@test-mocks": path.resolve(__dirname, "./tests/mocks"),
      "sharp": path.resolve(__dirname, "./tests/support/mocks/sharp.ts"),
      "file-saver": path.resolve(__dirname, "./tests/mocks/file-saver.ts"),
      "whisper-turbo": path.resolve(__dirname, "./tests/mocks/whisper-turbo.ts"),
      "whisper-webgpu": path.resolve(__dirname, "./tests/mocks/whisper-turbo.ts"),
    },
  },
  define: {
    TEST_MODE: JSON.stringify(process.env.VITE_TEST_MODE === 'true'),
  },
  optimizeDeps: {
    exclude: ['whisper-turbo', 'whisper-webgpu']
  }
});