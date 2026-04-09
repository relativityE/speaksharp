/* eslint-env node */
// vitest.config.mjs
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [
    tsconfigPaths({ projects: [path.resolve(__dirname, 'tsconfig.json')] }),
    react()
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    root: path.resolve(__dirname, '..'),
    include: [
      'frontend/src/**/*.test.{js,jsx,ts,tsx}',
      'frontend/tests/**/*.test.{js,jsx,ts,tsx}',
      'tests/**/*.test.{js,jsx,ts,tsx}'
    ],
    exclude: ['node_modules/', 'dist/', 'build/', '**/*.spec.{ts,tsx}'],
    setupFiles: [
      path.resolve(__dirname, './tests/setup.ts')
    ],
    testTimeout: 30000,
    hookTimeout: 10000,
    teardownTimeout: 15000,
    reporters: ['default', path.resolve(__dirname, '../scripts/vitest-ci-reporter.mjs')],
    // Suppress console.log noise from tests in CI mode
    silent: !process.env.CI_DEBUG,
    // ─── Coverage ────────────────────────────────────────────────────────────
    // FIX: was `coverage: { enabled: false }` which suppressed coverage even
    // when --coverage was passed on the CLI (enabled:false short-circuits the
    // coverage provider init in Vitest 3.x before CLI flags are applied).
    //
    // reportsDirectory: './frontend/coverage'
    //   root is set to path.resolve(__dirname, '..') = project root.
    //   Vitest resolves reportsDirectory relative to root.
    //   run-metrics.sh reads: frontend/coverage/coverage-summary.json
    //   Therefore this path must be './frontend/coverage' (relative to project root).
    //   DO NOT change this without also updating coverage_file in run-metrics.sh.
    //
    // reporter: 'json-summary' → produces coverage-summary.json (NOT 'json',
    //   which produces coverage-final.json — a different file, different schema).
    coverage: {
      enabled: true,
      provider: 'v8',
      reportsDirectory: path.resolve(__dirname, '../frontend/coverage'),
      reporter: [
        'text',         // console table — visible in CI logs
        'json-summary', // → coverage-summary.json — consumed by run-metrics.sh
        'html',         // → index.html — for local browsing, gitignored
      ],
      include: ['frontend/src/**/*.{ts,tsx}'],
      exclude: [
        'frontend/src/**/*.test.{ts,tsx}',
        'frontend/src/**/*.spec.{ts,tsx}',
        'frontend/src/**/*.d.ts',
        'frontend/src/constants/**',
        'frontend/src/types/**',
        'frontend/src/**/index.ts',
        '**/*.config.{ts,mjs,js}',
      ],
      // Conservative starting thresholds — tighten each sprint once
      // actual numbers are visible. CI fails with exact shortfall message.
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 60,
        lines: 60,
      },
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
      NODE_ENV: 'test',
    },
    // Fix deprecation: "deps.inline" -> "server.deps.inline"
    server: {
      deps: {
        inline: ["@xenova/transformers", "whisper-turbo", "whisper-webgpu"],
      }
    }
  },
  define: {},
  optimizeDeps: {
    exclude: ['whisper-turbo', 'whisper-webgpu']
  }
});