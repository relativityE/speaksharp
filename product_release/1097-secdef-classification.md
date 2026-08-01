# #1097 PR-A — SECURITY DEFINER classification (verified against real PostgreSQL)

**Status label:** `source-applied; deployed-unverified`.
**What is proven:** the effective privilege state that the **committed migrations** produce when applied
**verbatim** to a real PostgreSQL (the `.github/workflows/secdef-classification.yml` matrix runs this on
`postgres:15/16/17`; locally reproduced on PGlite, PG16 semantics: **79/80** migrations applied, the single
skip being an RLS-policy migration irrelevant to function ACLs).
**What is NOT proven:** the *current hosted Supabase instance's* ACLs. No production query or mutation was
performed. Confirming the hosted state requires a separately-authorized read-only check (a `\du`-class ACL
read against production) — deliberately out of scope here.

## Method

- `tests/db/secdef-classification-prelude.sql` — stubs only what Supabase preinstalls (roles `anon` /
  `authenticated` / `service_role` / `authenticator` / `supabase_admin`, `auth`/`storage` schemas, `auth.*`
  helpers, `uuid-ossp` + `pgcrypto`). No product object is created here.
- All committed timestamped migrations are applied **verbatim, in order** (non-timestamped helper files
  `rotate_sessions.sql` / `test_usage_rpc.sql` are not part of the ordered set and are skipped, logged).
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

### A. Anon-reachable (the risk surface) — 7 functions
| Function (exact signature) | `search_path` | anon EXECUTE | Why exposed | Risk |
|---|---|---|---|---|
| `cleanup_expired_sessions()` | **(none)** | yes | PUBLIC default | **HIGH** — no `search_path` (pg_temp first) **and** anon can invoke a state-mutating cleanup |
| `expire_stale_sessions()` | **(none)** | yes | PUBLIC default | **HIGH** — same as above |
| `update_user_usage(integer)` | `public` | yes | PUBLIC default | **HIGH** — anon can mutate usage accounting (the `(integer,text,uuid)` overload is correctly locked) |
| `acquire_recording_lease(uuid,text,boolean)` | `public` | yes | explicit PUBLIC grant | MED — anon can acquire recording leases |
| `heartbeat_recording_lease(uuid)` | `public` | yes | explicit PUBLIC grant | MED — anon can heartbeat leases |
| `release_recording_lease(uuid)` | `public` | yes | explicit PUBLIC grant | MED — anon can release leases |
| `ensure_trial_profile_for_new_user()` | `public` | yes | PUBLIC default | LOW — trigger function; direct EXECUTE grant is unnecessary |

### B. Locked to `authenticated` (+ owner/service_role), REVOKEd from PUBLIC — 13 functions
`check_usage_limit()`, `update_user_usage(integer,text,uuid)`, `create_session_and_update_usage(...)`,
`complete_session(...)`, `heartbeat_session(uuid,integer)`, `consume_ai_suggestion_quota(...)`,
`consume_formatter_quota(...)`,
`get_analytics_summary(uuid)`, `set_user_timezone(text)`, `record_progress_evaluation(uuid)`,
`record_progress_recommendation(...)`, `record_recommendation_attempt(uuid)`,
`advance_recommendation_attempt(...)`.
(`normalize_user_filler_word` and `rotate_user_sessions` are NOT `SECURITY DEFINER` in the deployed set — the
harness introspects `pg_proc.prosecdef`, and neither appears; they were removed from this list.)
Of these, the **hardened** subset also lists `pg_temp` explicitly last (`get_analytics_summary`,
`set_user_timezone`, `record_progress_*`, `advance_recommendation_attempt`) — the target shape.

### C. Locked to service_role/owner only (no anon/authenticated) — 2 functions
`get_user_id_by_email(text)` (`search_path = ''`), `process_stripe_webhook_event(...)` (both overloads),
`enforce_report_session_ownership()` (`pg_catalog, public`; trigger).

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

This report is the durable **classification evidence**. The proposed **PR-B implementation planning** (exact
`REVOKE`/`GRANT`/`ALTER FUNCTION` statements, migration behavior, rollback, and falsification tests)
deliberately lives in the **PR #1135 description**, not here — implementation planning is not durable
product-release evidence and must not accrete in this file.

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
