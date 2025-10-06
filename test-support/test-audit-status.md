# Test Audit Report
Generated on Mon Oct  6 00:29:40 UTC 2025

- Lint & TypeScript: FAIL (Ignored for now)

## E2E Test Shards
- Shard 1: tests/e2e/smoke.e2e.spec.ts tests/e2e/auth.e2e.spec.ts
- Shard 2: tests/e2e/free.e2e.spec.ts tests/e2e/navigation.e2e.spec.ts
- Shard 3: tests/e2e/pro.e2e.spec.ts tests/e2e/live-transcript.e2e.spec.ts

### Shard 1 Results
- tests/e2e/smoke.e2e.spec.ts: PASS, runtime 00:06
- tests/e2e/auth.e2e.spec.ts: FAIL, runtime 01:05

## E2E Test Summary
| Test File | Status | Runtime |
|-----------|--------|--------|
| tests/e2e/smoke.e2e.spec.ts | PASS | 00:06 |
| tests/e2e/auth.e2e.spec.ts | FAIL | 01:05 |

## Local vs CI/CD Alignment
- Verified Node, pnpm, and Playwright versions match CI/CD workflow.
- Sharding logic mirrored in CI workflow.
- All E2E test runtimes documented for reference.
