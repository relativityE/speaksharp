# Test Audit Report
Generated on Mon Oct  6 11:14:06 UTC 2025

- Lint & TypeScript: PASS

## E2E Test Shards (Dynamically Generated)
- Shard 1: tests/e2e/auth.e2e.spec.ts tests/e2e/free.e2e.spec.ts tests/e2e/pro.e2e.spec.ts tests/e2e/navigation.e2e.spec.ts tests/e2e/live-transcript.e2e.spec.ts tests/e2e/smoke.e2e.spec.ts

### Shard 1 Results
- tests/e2e/auth.e2e.spec.ts: FAIL, runtime 01:01
- tests/e2e/free.e2e.spec.ts: FAIL, runtime 00:39
- tests/e2e/pro.e2e.spec.ts: FAIL, runtime 00:32
- tests/e2e/navigation.e2e.spec.ts: FAIL, runtime 00:17
- tests/e2e/live-transcript.e2e.spec.ts: FAIL, runtime 00:14
- tests/e2e/smoke.e2e.spec.ts: PASS, runtime 00:06

## E2E Test Summary
| Test File | Status | Runtime |
|-----------|--------|--------|
| tests/e2e/auth.e2e.spec.ts | FAIL | 01:01 |
| tests/e2e/free.e2e.spec.ts | FAIL | 00:39 |
| tests/e2e/pro.e2e.spec.ts | FAIL | 00:32 |
| tests/e2e/navigation.e2e.spec.ts | FAIL | 00:17 |
| tests/e2e/live-transcript.e2e.spec.ts | FAIL | 00:14 |
| tests/e2e/smoke.e2e.spec.ts | PASS | 00:06 |
## Local vs CI/CD Alignment
- Verified Node, pnpm, and Playwright versions match CI/CD workflow.
- Sharding logic mirrored in CI workflow.
- All E2E test runtimes documented for reference.
