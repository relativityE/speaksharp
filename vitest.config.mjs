/* eslint-env node */
// ROOT vitest config — #1314 / #1258 Phase A test-infrastructure correction.
//
// WHY THIS FILE EXISTS. The project's only vitest config lived at `frontend/vitest.config.mjs`, reachable solely
// via `pnpm test:unit` (`vitest run --config frontend/vitest.config.mjs`). A bare `npx vitest run …` from the repo
// root therefore loaded NO config at all, which silently produced two wrong answers rather than an error:
//
//   1. FALSE FAILURES — without the `@` alias, root-level suites that import `@/services/…` failed to resolve.
//      `tests/release/launch-telemetry-content-free.contract.test.ts` "failed" for exactly this reason while
//      being perfectly healthy under the real config.
//   2. FALSE PASSES, which is worse — without the root-anchored `include`, vitest's default `**/*.test.*` glob
//      swept `test-support/worktrees/**`: other branches' checkouts. Those stale foreign tests were collected,
//      counted, and could fail (or pass) on code that is not this branch's, inflating totals and misattributing
//      results.
//
// Re-exporting the single real config makes the root invocation behave identically to `pnpm test:unit`, so there
// is exactly ONE test-collection authority no matter how vitest is started. Guarded by
// `tests/deps/vitest-collection-integrity.test.ts`.
export { default } from './frontend/vitest.config.mjs';
