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

So the GHSA-5xrq suppression **is honored in CI** (the "1 ignored"), and the gate is green under pinned pnpm 10.29.1.

**Open verification (unresolved).** The summary reads `2 critical (1 ignored)` — one critical advisory beyond the ignored vitest one is reported, yet the gate passes. Confirm whether the second critical is (a) a second dependency path to the same GHSA-5xrq (so effectively 0 unignored critical → correct pass), or (b) a distinct critical that should be triaged. pnpm's summary does not print per-advisory detail; run `pnpm audit --json` in CI to enumerate. Until confirmed, treat "the gate proves zero unignored criticals" as **provisional**.

**Real remediation (recommended).** Upgrade `vitest` to `>= 4.1.0` (retires GHSA-5xrq entirely, removing the suppression). This is a major 3→4 bump requiring unit-suite + coverage + `vitest.config.mjs` re-validation; schedule as a standalone change. Separately, fix the local audit path (the retired endpoint) if local `rc:gate:4:sca` reproduction is desired — e.g. pin a pnpm that uses the bulk advisory endpoint.
