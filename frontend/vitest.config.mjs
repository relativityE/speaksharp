/* eslint-env node */
// vitest.config.mjs
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
// #1262 — single coverage-threshold authority, shared with scripts/merge-coverage.mjs so the local gate
// and the CI (sharded) gate can never drift apart.
import { toVitestThresholds } from '../scripts/coverage-thresholds.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log(`[VITEST-CONFIG] 🏁 Loading from ${__filename}`);
console.log(`[VITEST-CONFIG] 📍 __dirname: ${__dirname}`);
console.log(`[VITEST-CONFIG] 🗺️ Alias @ -> ${path.resolve(__dirname, 'src')}`);

const coverageDirectory = path.resolve(__dirname, '../artifacts/coverage');
fs.mkdirSync(path.join(coverageDirectory, '.tmp'), { recursive: true });

export default defineConfig({
  plugins: [
    tsconfigPaths({ projects: [path.resolve(__dirname, 'tsconfig.json')] }),
    react()
  ],
  resolve: {
    alias: [
      { find: /^@\/(.*)/, replacement: path.resolve(__dirname, 'src/$1') },
      { find: '@', replacement: path.resolve(__dirname, 'src') }
    ]
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
    reporters: ['default'],
    // Suppress console.log noise from tests in CI mode
    silent: !process.env.CI_DEBUG,
    // ─── Coverage ────────────────────────────────────────────────────────────
    // FIX: was `coverage: { enabled: false }` which suppressed coverage even
    // when --coverage was passed on the CLI (enabled:false short-circuits the
    // coverage provider init in Vitest 3.x before CLI flags are applied).
    //
    // reportsDirectory: '../artifacts/coverage'
    //   root is set to path.resolve(__dirname, '..') = project root.
    //   Vitest resolves reportsDirectory relative to root.
    //   run-metrics.sh reads artifacts/coverage first, then frontend/coverage for
    //   backward compatibility with older CI artifacts.
    //   DO NOT change this without also updating coverage_file in run-metrics.sh.
    //
    // reporter: 'json-summary' → produces coverage-summary.json (NOT 'json',
    //   which produces coverage-final.json — a different file, different schema).
      coverage: {
        enabled: true,
        provider: 'v8',
        reportsDirectory: coverageDirectory,
        reporter: ['json-summary'],
      clean: false,
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
      // Floor raised 60 -> 75 to lock in current actual coverage (~76.5% lines/stmts, 77.8%
      // functions, 80.2% branches) so regressions are caught. Branches held at 75 (not 80) for
      // headroom; a future sprint can target 80. CI fails with the exact shortfall message.
      // NOTE: We only apply thresholds if CI_SHARD_MODE is not true. In shard mode, each shard
      // only tests a subset of files, so it would falsely fail coverage thresholds — the merged gate in
      // scripts/merge-coverage.mjs enforces them instead, from the SAME shared authority.
      thresholds: process.env.CI_SHARD_MODE === 'true' ? undefined : toVitestThresholds(),
    },

    // Process isolation: each test file runs in its own fork so React/Zustand state is fresh.
    //
    // CI-PERF: fork count is ENV-CONTROLLED via VITEST_MAX_FORKS (default 1).
    // It was previously hardcoded to 1 under a comment claiming "Locally: 3 forks" — the code never
    // did that, and sequential execution is the single largest cost in the full-coverage job.
    // Raise deliberately (VITEST_MAX_FORKS=2) and prove memory/isolation stability before going higher;
    // resource-heavy STT suites can still be pinned back to 1 by setting the variable.
    pool: 'forks',
    poolOptions: {
      forks: {
        isolate: true,
        maxForks: Number(process.env.VITEST_MAX_FORKS) > 0 ? Number(process.env.VITEST_MAX_FORKS) : 1,
        execArgv: ['--max-old-space-size=4096']
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
        inline: ["@xenova/transformers"],
      }
    }
  },
  define: {},
  optimizeDeps: {
    exclude: []
  }
});
