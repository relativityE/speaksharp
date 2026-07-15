**Owner:** relativityE
**Last Reviewed:** 2026-07-15

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

---

## Pinned-audit execution result (2026-07-15)

**Exact gate command:** `pnpm audit --audit-level critical` (script `rc:gate:4:sca`), pinned **pnpm 10.29.1** (`package.json` `packageManager`), node 22.

**Where `vitest` lives / workspace scope.** `vitest@^3.2.4` is a **root** `devDependency`. `pnpm-workspace.yaml` lists only `packages: ['backend/functions/*']` — the frontend is **not** a workspace member. The suppression therefore lives in the **root** `package.json` → `pnpm.auditConfig.ignoreGhsas` (the supported mechanism for the root project the gate audits), and that is the correct home for it. No workspace re-homing is required for the suppression to be in scope; `@vitest/coverage-v8@^4.1.0` already sits in `frontend/package.json` as a partial-migration signal.

**Local reproduction — NOT possible in this environment (do not claim "works" from a local run):**
- `corepack pnpm audit …` fails before auditing: corepack's bundled signing keys can't verify pnpm 10.29.1 (`Cannot find matching keyid`) — a corepack/node-version issue, not an audit result.
- A standalone `npx pnpm@10.29.1 audit --audit-level critical` reaches the network and returns **HTTP 410**: `The audit endpoint (…/-/npm/v1/security/audits) responded with 410: This endpoint is being retired. Use the bulk advisory endpoint instead.` The pinned pnpm's `audit` calls the retired legacy npm endpoint locally.

**CI is the authoritative run (same pinned pnpm 10.29.1).** In `rc-gates.yml` → `gate-4-sca`, `pnpm audit --audit-level critical` executes and the job **passes**. Latest evidence: run `29351358038` on `519b8e17` (rc3, 2026-07-14), gate-4-sca = **success**, audit output:

```
> pnpm audit --audit-level critical
110 vulnerabilities found
Severity: 11 low | 48 moderate | 49 high | 2 critical (1 ignored)
```

That gate-4-sca run **predates the npm legacy-audit endpoint retirement** (see below); its summary is retained as historical context.

**Both criticals identified — PROVEN, not provisional (2026-07-15).** The `2 critical (1 ignored)` summary is a **duplicate-path artifact of a single advisory**, confirmed two ways:
- **`pnpm audit --json` re-run in CI with the exact pinned pnpm 10.29.1** now returns `ERR_PNPM_AUDIT_BAD_RESPONSE` — HTTP **410** from `registry.npmjs.org/-/npm/v1/security/audits` (*"This endpoint is being retired. Use the bulk advisory endpoint instead."*). pnpm 10.29.1's `audit` calls the retired legacy endpoint, so it can no longer enumerate — **and `pnpm audit --audit-level critical` now exits 1**, i.e. the `rc:gate:4:sca` gate is currently broken in CI, not just locally.
- **`osv-scanner` (endpoint-independent, dedupes by advisory) over the root `pnpm-lock.yaml`** reports the full tree — `1 critical | 46 high | 46 moderate | 11 low` — and the **only critical is `vitest@3.2.4` → GHSA-5xrq-8626-4rwp**, i.e. the already-ignored advisory. There is **no second distinct critical**. `vitest@3.2.4` is resolved into two importers (root devDependency and frontend via `@vitest/coverage-v8@4.1.9(vitest@3.2.4)`), which is exactly why pnpm counts *2 critical findings of the same advisory*.

**Conclusion: zero unignored *distinct* criticals.** The sole critical advisory is GHSA-5xrq, fully covered by the `pnpm.auditConfig.ignoreGhsas` suppression.

**Required remediation (two items).**
1. **Un-break the SCA gate.** `pnpm audit` (pinned 10.29.1) hits the retired endpoint and now fails/errors everywhere. Move the gate off it: upgrade to a pnpm that uses the bulk advisory endpoint, or replace `rc:gate:4:sca` with `osv-scanner` (used for this enumeration) or GitHub Dependency Review. Until then the gate cannot produce a valid pass/fail.
2. **Retire the suppression.** Upgrade `vitest` to `>= 4.1.0` (removes GHSA-5xrq and the `ignoreGhsas` entry entirely). Major 3→4 bump — re-validate unit suite + coverage + `vitest.config.mjs`; schedule standalone.
