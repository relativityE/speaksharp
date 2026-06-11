**Owner:** dev-agent
**Last Reviewed:** 2026-06-05

# SCA / Dependency-Audit Exceptions

Documented, justified suppressions for `pnpm audit` (the `rc:gate:4:sca` gate runs
`pnpm audit --audit-level critical`). Each entry must state the advisory, why it is not
reachable in this codebase, the compensating control, and the real remediation path.

Suppressions live in `package.json` → `pnpm.auditConfig.ignoreGhsas`.

---

## GHSA-5xrq-8626-4rwp — Vitest UI server arbitrary file read/exec

| Field | Value |
|---|---|
| Package | `vitest` (`<4.1.0`); installed `3.2.4` |
| Severity | Critical |
| Advisory | https://github.com/advisories/GHSA-5xrq-8626-4rwp |
| Status | **Suppressed (not reachable)** |

**Why it does not apply here.** The vulnerability requires the **Vitest UI / API server to be
listening** ("When Vitest UI server is listening, arbitrary file can be read and executed"). This
repo never starts it: there is **no `vitest --ui` / `--api` script**, CI and local runs use
`vitest run` only, and `vitest` is a **devDependency** that ships in no production/runtime bundle.
The exploit precondition (a listening, network-reachable UI server) is therefore unreachable.

**Compensating controls.** No script exposes the UI/API server; `@vitest/ui` is dormant (declared
but never invoked) and can be dropped at the next dependency pass.

**Real remediation (deferred).** Upgrade to `vitest >= 4.1.0`. This is a **major** version bump
(3 → 4) that requires re-validating the full unit suite, coverage thresholds, and the
`vitest.config.mjs` API surface, so it is scheduled as a standalone change rather than bundled into
a release-gate fix. (Note: `frontend/package.json` already carries `@vitest/coverage-v8@^4.1.0`,
i.e. a partial migration is in flight.)

**Re-review trigger.** Remove this suppression once vitest is on `>= 4.1.0`, or sooner if any script
begins exposing the Vitest UI/API server.
