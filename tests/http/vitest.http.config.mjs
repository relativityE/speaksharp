// #1258 — collects ONLY the disposable-stack HTTP proofs (`*.http.ts`), which need a running PostgREST. They are
// deliberately outside the unit suite's `*.test.*` include, so the unit totals never carry a skipped proof.
// Replaces (not merges) `include`: vite's mergeConfig would CONCATENATE arrays and pull the whole unit suite in.
import base from '../../frontend/vitest.config.mjs';

export default {
  ...base,
  test: {
    ...base.test,
    include: ['tests/http/**/*.http.ts'],
    environment: 'node',
    setupFiles: [],
    coverage: { enabled: false },
  },
};
