**Status:** Plan — not implemented, not applied
**Owner:** Engineering (relativityE)
**Last Reviewed:** 2026-08-29
**Last Verified:** 2026-08-29 (caller inventory and grants read from `origin/main@0e2fffd1`)
**Applies To:** Retiring the legacy `complete_session` (v1) overloads after the v2 cutover.
**Class:** Procedure (work item — temporary).
**Authority:** The closure checklist and falsification plan for the Stage-B successor.
**Not Authoritative For:** release posture, or authorization to apply any migration.
**Supersedes:** — (historical PR #1310 is NOT revived; this is a fresh successor from current `main`)
**Evidence Sources:** `backend/supabase/migrations/*.sql`, `frontend/src/lib/storage.ts`, repository-wide grep.

# Stage-B successor — retire legacy `complete_session` v1

Fresh branch from `origin/main@0e2fffd1`. **Historical PR #1310 is not revived or rebased**; its stated
precondition (Attempt 10) can no longer occur.

## 1. What is actually there

Two legacy overloads survive the v2 cutover, and **both are granted to `authenticated`** — any signed-in user
can call them directly:

| Overload | Signature | Grants | Why it matters |
|---|---|---|---|
| **V1-A** transcript-accepting | `complete_session(UUID, TEXT, TEXT, INT, TEXT)` | `authenticated`, `service_role` | The 3rd argument **is the transcript**. This path writes transcript text **without** v2's newest-two retention convergence and **without** the filler-map validation the client fails closed on. |
| **V1-B** metrics-only (Stage A) | `complete_session(UUID, TEXT, INT, TEXT, JSONB, INT, DOUBLE PRECISION, DOUBLE PRECISION, JSONB, JSONB)` | `authenticated`, `service_role` | Additive Stage-A overload; superseded by `complete_session_v2`. |

Latest definitions: V1-A `20260812041500_flawless_launch_runtime_convergence_1290.sql:715`;
V1-B `20260816223606_metrics_only_additive_1306.sql:126`.

**V1-A is the reason this work exists.** It is not merely dead surface — it is a reachable second write path
to transcript persistence that does not honour the retention contract.

## 2. Production callers: zero

Verified by repository-wide grep on `origin/main@0e2fffd1`. Every remaining reference is a test double, a
comment, or a SQL fixture — **no production code path calls v1**:

| Reference | Kind | Disposition |
|---|---|---|
| `frontend/src/lib/storage.ts` | Calls `complete_session_v2` only; documents "NO v1 FALLBACK" | correct, no change |
| `frontend/src/mocks/handlers.ts:389` | MSW handler that **rejects** v1 with `PGRST202` | keep — it proves the client never calls v1 |
| `frontend/src/lib/mockSupabase.ts:184` | Mock that **rejects** v1 | keep |
| `frontend/src/hooks/useSessionLifecycle.ts:268` | Comment only | no change |
| `tests/live/three-session-retention-proof.live.spec.ts:670` | Asserts **zero** v1 RPC calls in production | keep — this is the production-caller proof |
| `tests/db/*.sql`, `tests/db/*.integration.test.ts` | Fixtures that `CREATE FUNCTION public.complete_session(...)` | **blocker — see §3** |

## 3. Named blocker — the DB tests build their own schema

`tests/db/metrics-only-stage-a.integration.test.ts:41`, `tests/db/analytics-summary-rpc.integration.test.ts:54`
and `tests/db/atomic-completion-concurrency-realpg.sql:32` each **`CREATE FUNCTION public.complete_session(...)`
by hand**. They therefore test a handwritten substitute, not the shipped migration.

A retirement proven against a handwritten definition proves nothing about production: the substitute can be
dropped while the deployed function survives. **The successor must exercise the shipped migrations**, applied in
order to a real Postgres, and assert against the resulting catalog.

## 4. Closure checklist

- [ ] A migration that **revokes and drops both** V1-A and V1-B, by exact signature.
- [ ] Ordered application against a real Postgres from the **shipped** migration set — no handwritten
      `CREATE FUNCTION public.complete_session`.
- [ ] Catalog assertion: after the migration, `complete_session` resolves to **no** overload; `complete_session_v2`
      resolves to exactly one.
- [ ] `complete_session_v2` newest-two transcript/metrics contract **unchanged** — retention convergence, filler
      validation, and atomic completion all still proven by their existing tests.
- [ ] A **named failure** for any remaining v1 path: a call to either legacy signature must fail with an explicit
      error, never silently no-op or fall through to v2.
- [ ] Zero production callers re-proven at the exact head (the live retention proof already asserts this).
- [ ] Exact-head CI, all jobs reported individually.
- [ ] Migration is **source only** — application to production requires separate written authorization and is
      **not** part of this PR.

## 5. Expected mutant casualties — named before the run

| # | Mutant | Must fail |
|---|---|---|
| M1 | Drop only V1-A, leave V1-B | catalog assertion: `complete_session` still resolves an overload |
| M2 | Drop only V1-B, leave V1-A | same, **and** the transcript-path test: a transcript is persisted outside the retention contract |
| M3 | `REVOKE` the grants but do not `DROP` | `service_role` can still invoke the transcript path — revocation is not retirement |
| M4 | Restore the handwritten `CREATE FUNCTION public.complete_session` in a DB test | the shipped-schema guard: tests must not define the object under test |
| M5 | Make a v1 call fall through to v2 instead of erroring | the named-failure test: a silent redirect hides a caller we needed to find |

If a mutant survives, the corresponding assertion is decorative and must be rewritten before merge.

## 6. Explicitly out of scope

- No change to `complete_session_v2` behaviour.
- No migration application, no production write, no deployment.
- No STT, runtime, or model files — this lane must never contend with the benchmark host.
