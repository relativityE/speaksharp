# #1097 PR-A — SECURITY DEFINER classification (verified against real PostgreSQL)

**Status label:** `source-applied; deployed-unverified`.
**What is proven:** the effective privilege state that the **committed migrations** produce when constructed
into a **disposable** PostgreSQL classification database (the `.github/workflows/secdef-classification.yml`
matrix runs this on `postgres:15/16/17`; reproduced on PGlite: **80/80** migrations applied). **Function
definitions and GRANT/REVOKE statements are replayed verbatim; a deterministic allowlist normalizes only
known historical RLS-policy DDL defects needed to construct the disposable classification database** (see
below).
**What is NOT proven:** the *current hosted Supabase instance's* ACLs. The disposable replay verifies what the
committed migrations PRODUCE — it does **not** verify hosted Supabase state. No production query or mutation
was performed. Confirming the hosted state requires a separately-authorized read-only check (a `\du`-class ACL
read against production) — deliberately out of scope here.

## Method

- `tests/db/secdef-classification-prelude.sql` — stubs only what Supabase preinstalls (roles `anon` /
  `authenticated` / `service_role` / `authenticator` / `supabase_admin`, `auth`/`storage` schemas, `auth.*`
  helpers, `uuid-ossp` + `pgcrypto`). No product object is created here.
- All committed versioned migrations (`^[0-9]{8,}_`, incl. the 8-digit `20251217_…`) are applied in
  filename order (non-versioned helpers `rotate_sessions.sql` / `test_usage_rpc.sql` are skipped, logged).
  Every **function / GRANT / REVOKE / table** statement — the classification targets — is applied **verbatim**
  under `ON_ERROR_STOP=1`. Any migration **not** on the normalization allowlist that fails replay **fails the
  job closed** — it is never silently normalized.

### Migration replay-drift (deterministic allowlist + provenance debt)
The committed migration history is **not cleanly verbatim-replayable on a fresh database**. The normalizer
(`scripts/secdef-normalize-migration.mjs`) carries an **exact allowlist** — currently exactly one file:
- **`20250825065500_fix_rls_performance_issue.sql`** — `DROP`s four policies `initial_schema` never created
  **and** re-creates `"Users can manage own sessions"` (already created by `initial_schema`).
For an allowlisted file it normalizes **only RLS-policy DDL** (`DROP POLICY`→`DROP POLICY IF EXISTS`; an
**inline** `DROP POLICY IF EXISTS` precedes each real `CREATE POLICY` — inline so a statement commented out on
its line stays a no-op). **No function / GRANT / REVOKE / table DDL is transformed**, proven by
`tests/db/secdef-normalize.contract.test.js` (residue-identity + keyword-count checks; non-allowlisted files
pass through byte-identical). Separately, `20250825101500_fix_rls_performance_on_user_profiles.sql` is a
committed **no-op** (its SQL sits after a same-line `--`) — recorded here as **provenance debt**; it is applied
verbatim (not allowlisted) and is a harmless no-op. This RLS-policy replay-drift does not block or bias the
SECURITY DEFINER classification and is filed as provenance debt for a separate cleanup.
- `tests/db/secdef-classification-matrix.sql` — introspects `pg_proc` for every `SECURITY DEFINER` function
  in `public`; reports signature, `search_path`, `pg_temp` exposure, and effective EXECUTE for
  PUBLIC/anon/authenticated. It fails closed unless it is non-vacuous **and** discriminating (detects both
  locked and anon-reachable functions), so a blind harness cannot pass.

### `search_path` note (per PO correction)
`search_path = public` (no explicit `pg_temp`) is **not** safe on its own: PostgreSQL still searches
`pg_temp` **first** for table/type resolution. Only an explicit `pg_temp` placed **last**
(`pg_catalog, public, pg_temp`) or `search_path = ''` with fully-qualified names neutralises temp-object
shadowing.

## Classification result — 24 `SECURITY DEFINER` functions in `public`

### A. Anon-EXECUTE exposed — 6 functions
**anon EXECUTE exposure ≠ successful anon usage-mutation.** A function can carry an anon EXECUTE grant yet
mutate nothing when invoked by `anon`, because it self-scopes on `auth.uid()` (NULL for anon). The genuine
hazard is the subset where anon EXECUTE would *actually mutate* state. The harness reports the grant
(`has_function_privilege('anon', …)`); the mutation column is a body-read judgement.

| Function | `search_path` | anon EXECUTE (grant) | Successful anon usage-mutation? | Risk |
|---|---|---|---|---|
| `cleanup_expired_sessions()` | **(none)** | yes | **YES** — `UPDATE public.sessions … WHERE status='active'` with **no `auth.uid()` scoping** (cross-tenant) | **HIGH** |
| `expire_stale_sessions()` | **(none)** | yes | **YES** — same cross-tenant, no `auth.uid()` scoping | **HIGH** |
| `update_user_usage(integer)` | `public` | yes | **No** (mitigated) — delegates to the `auth.uid()`-scoped `(integer,text,uuid)` overload; anon's NULL uid mutates nothing | LOW (surplus grant) |
| `acquire_recording_lease(uuid,text,boolean)` | `public` | yes | **No** (mitigated) — `v_uid := auth.uid()`, all writes `WHERE user_id = v_uid`; anon no-ops | LOW (surplus grant) |
| `heartbeat_recording_lease(uuid)` | `public` | yes | **No** (mitigated) — self-scoped on `auth.uid()` | LOW (surplus grant) |
| `release_recording_lease(uuid)` | `public` | yes | **No** (mitigated) — self-scoped on `auth.uid()` | LOW (surplus grant) |

`ensure_trial_profile_for_new_user()` carries a PUBLIC/anon EXECUTE grant too, but it is a **trigger** on
`auth.users` — not directly callable to mutate — so it is classified with the authenticated/trigger set (B),
not as an anon usage-mutation risk. Its surplus EXECUTE grant should still be revoked.

### B. Authenticated / owner context (no PUBLIC), REVOKEd from PUBLIC — 14 functions
Grantees are per-function from the actual `proacl`; there is **no blanket `service_role` grant** — most carry
only `authenticated` (+ the owner). `check_usage_limit()`, `update_user_usage(integer,text,uuid)`,
`create_session_and_update_usage(...)`, `complete_session(...)`, `heartbeat_session(uuid,integer)`,
`consume_ai_suggestion_quota(...)`, `consume_formatter_quota(...)`, `get_analytics_summary(uuid)`,
`set_user_timezone(text)`, `record_progress_evaluation(uuid)`, `record_progress_recommendation(...)`,
`record_recommendation_attempt(uuid)`, `advance_recommendation_attempt(...)`, plus the trigger functions
**`enforce_report_session_ownership()`** (`pg_catalog, public`; fires on an authenticated user's
`user_issue_reports` write) and **`ensure_trial_profile_for_new_user()`** (`auth.users` trigger; its surplus
PUBLIC EXECUTE grant is to be revoked). A `service_role` grant is called out ONLY where the function's actual
ACL shows one — never asserted blanket.
(`normalize_user_filler_word` and `rotate_user_sessions` are NOT `SECURITY DEFINER` in the deployed set —
`pg_proc.prosecdef` shows neither — so they are excluded.)
Hardened subset (explicit `pg_temp` last): `get_analytics_summary`, `set_user_timezone`, `record_progress_*`,
`advance_recommendation_attempt` — the target shape.

### C. Owner/service_role only (no anon/authenticated) — per-function, measured
`get_user_id_by_email(text)` (`search_path = ''`) and `process_stripe_webhook_event(...)` (both overloads):
their ACLs grant only the owner (+ `service_role` where the ACL literally shows it) — stated per function, not
blanket.

## Caller matrix (resolved from actual call sites, not memory)

Method: searched `frontend/`, `backend/supabase/functions/`, `backend/supabase/migrations/`, `.github/`,
`scripts/` for each function; recorded the runtime identity at each call site; tests are treated as evidence,
never as production callers.

**Ownership enforcement is NOT uniform — correction:** the recording-lease trio DOES self-enforce ownership
(`v_uid := auth.uid()`, scoped `WHERE user_id = v_uid AND lease_id = …`), so for those the anon grant is a
surplus-but-mitigated defense-in-depth gap. The **cleanup functions do NOT**: `cleanup_expired_sessions()`
runs `UPDATE public.sessions … WHERE status='active' AND expires_at < now()` and `expire_stale_sessions()`
similarly operate **across all users' rows with no `auth.uid()` scoping**. For those two, an anon EXECUTE
grant is a genuine cross-tenant hazard (an unauthenticated caller could drive a global session-expiry sweep),
not merely a redundant grant. Grants-alone is insufficient AND, for the cleanup workers, grants are the
*only* boundary — which is exactly why revoking PUBLIC/anon on them is the priority.

| Function | Real runtime caller (evidence) | Identity | Legitimate anon? |
|---|---|---|---|
| `acquire_recording_lease(uuid,text,boolean)` | **none** — `frontend/src/services/recordingLeasePolicy.ts` is a pure result-interpreter (no `supabase`/`.rpc`) and is **not imported** by any runtime module; no `.rpc('acquire_recording_lease')` exists anywhere | (would be authenticated user) | **no** |
| `heartbeat_recording_lease(uuid)` | **none** (same as above) | (would be authenticated user) | **no** |
| `release_recording_lease(uuid)` | **none** (same as above) | (would be authenticated user) | **no** |
| `cleanup_expired_sessions()` | **none found** (no `.rpc`, no `cron.schedule`, no Edge Function) | — | **no** |
| `expire_stale_sessions()` | only a **commented-out** `cron.schedule('*/5 * * * *', 'SELECT public.expire_stale_sessions()')` in `20260309000000_phase2_integration.sql:312` | db-internal cron (privileged) | **no** |
| `ensure_trial_profile_for_new_user()` | a **trigger** — `EXECUTE FUNCTION …` on `auth.users` (`20260521100000_auto_trial_entitlements.sql:134`) | db-internal trigger | **no** (triggers need no EXECUTE grant) |
| `update_user_usage(integer)` | **no direct caller** (internal helper; the app calls `create_session_and_update_usage`/`complete_session`, not this 1-arg overload directly) | definer-context (called from another SECURITY DEFINER fn) | **no** |

**Root cause of the anon exposure:** `20260607040000_active_recording_lease.sql` runs `GRANT EXECUTE … TO
authenticated` but never `REVOKE … FROM PUBLIC`, so PostgreSQL's default PUBLIC EXECUTE grant persists (and
PUBLIC includes `anon`). The other exposed functions are PUBLIC-by-default (never granted narrowly at all).

## Remediation direction (evidence-derived; the implementation packet is NOT in this durable doc)

This report is the durable **classification evidence**, indexed under the evidence authority
(`EVIDENCE_INDEX.md`). The proposed **PR-B implementation planning** (exact `REVOKE`/`GRANT`/`ALTER FUNCTION`
statements, migration behavior, rollback, and falsification tests) deliberately lives in the **PR #1135
description**, not here — implementation planning is not durable product-release evidence and must not accrete
in this file. **Remediation RISK is routed to the roadmap** (#1128) and its remediation successor (#1141 /
#1097 PR-B); **PR-B does not begin until this classification (PR-A) is accepted.**

Direction (bounded; do NOT broaden into a general category-B/C `search_path` sweep):
- Revoke `PUBLIC`/`anon` EXECUTE from the seven exposed functions — none has a legitimate anon caller
  (§caller matrix). No speculative grants: the recording-lease trio has **no** live caller (dead/deprecation
  candidate, wire-or-drop); the cleanup workers run privileged cron / no caller; the trigger + internal-helper
  functions need no direct grant; no deployed `service_role` caller exists today.
- Give the two cleanup workers a pg_temp-safe `search_path` (they have none) — the acute item, since they are
  **not** owner-scoped (see the ownership-enforcement correction above).

**Root cause** of the lease-trio leak: `20260607040000_active_recording_lease.sql` runs `GRANT … TO
authenticated` without `REVOKE … FROM PUBLIC`, leaving PostgreSQL's default PUBLIC grant. **No PR-B
implementation until this classification is reviewed and its target set approved.**

## Ownership and parent
- Parent issue: #1097 · Increment: PR-A (read-only classification) · Refs #1097, does not close.
- No production query/mutation. The recording-lease caller question is resolved above (from call sites, not
  memory). Merge/apply/deploy remain separate PO gates; **no PR-B implementation until PR-A review fixes the
  target set.**
