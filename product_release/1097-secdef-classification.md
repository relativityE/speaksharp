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

### B. Locked to `authenticated` (+ owner/service_role), REVOKEd from PUBLIC — 15 functions
`check_usage_limit()`, `update_user_usage(integer,text,uuid)`, `create_session_and_update_usage(...)`,
`complete_session(...)`, `heartbeat_session(uuid,integer)`, `consume_ai_suggestion_quota(...)`,
`consume_formatter_quota(...)`, `normalize_user_filler_word(...)`, `rotate_user_sessions(...)`,
`get_analytics_summary(uuid)`, `set_user_timezone(text)`, `record_progress_evaluation(uuid)`,
`record_progress_recommendation(...)`, `record_recommendation_attempt(uuid)`,
`advance_recommendation_attempt(...)`.
Of these, the **hardened** subset also lists `pg_temp` explicitly last (`get_analytics_summary`,
`set_user_timezone`, `record_progress_*`, `advance_recommendation_attempt`) — the target shape.

### C. Locked to service_role/owner only (no anon/authenticated) — 2 functions
`get_user_id_by_email(text)` (`search_path = ''`), `process_stripe_webhook_event(...)` (both overloads),
`enforce_report_session_ownership()` (`pg_catalog, public`; trigger).

## Caller matrix (resolved from actual call sites, not memory)

Method: searched `frontend/`, `backend/supabase/functions/`, `backend/supabase/migrations/`, `.github/`,
`scripts/` for each function; recorded the runtime identity at each call site; tests are treated as evidence,
never as production callers. Every function below is `SECURITY DEFINER` and independently derives
`v_uid := auth.uid()` and scopes all work to the owner (e.g. `WHERE user_id = v_uid AND lease_id = …`), so
grants are defense-in-depth, not the only control — but minimal grants are still required (grants-alone is
insufficient AND surplus grants are still wrong).

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

## Narrow PR-B remediation set (proposal only — not to be coded until this target set is reviewed)

**Scope discipline:** remediate ONLY the confirmed defects below. Do **not** broaden into a general
`search_path` sweep of category B/C or unrelated hardening.

1. **`REVOKE EXECUTE … FROM PUBLIC` and `FROM anon`** on all seven exposed functions — none has a legitimate
   anonymous caller. Minimum grants after revoke, per the caller matrix:
   - **recording-lease trio** — **classify as dead/deprecation candidates** (no live runtime caller). Do
     **not** preserve access speculatively: revoke PUBLIC/anon now; grant `authenticated` **only if/when** the
     user recording path is actually wired to call them (it is not today). Recommend a separate decision to
     either wire the account-wide-mutex feature or drop the trio + `active_recording_lease` table + the dead
     `recordingLeasePolicy.ts`.
   - **`cleanup_expired_sessions()`** — no caller at all → dead/deprecation candidate; revoke PUBLIC/anon.
   - **`expire_stale_sessions()`** — intended db-internal cron caller (currently commented out) runs
     privileged and needs no PUBLIC/anon grant; revoke PUBLIC/anon.
   - **`ensure_trial_profile_for_new_user()`** — trigger function; revoke PUBLIC/anon (needs no EXECUTE grant).
   - **`update_user_usage(integer)`** — internal helper; revoke PUBLIC/anon (the `(integer,text,uuid)`
     overload is already correctly locked to `authenticated`/`service_role`).
   - Grant `service_role` **only** where a concrete deployed server caller exists — **none does today**, so
     no new `service_role` grant is warranted.
2. **Set a pg_temp-safe `search_path`** on the two functions that have none —
   `cleanup_expired_sessions()` and `expire_stale_sessions()` — to `pg_catalog, public, pg_temp` (pg_temp
   last) or `''` with fully-qualified object references. (The lease trio + `update_user_usage` use
   `search_path = public`; hardening their `pg_temp` exposure is a category-B item, out of this narrow PR-B
   unless review says otherwise.)

### PR-B implementation packet (finalize after PR-A review fixes the target set)
- **Functions & grants:** exact `REVOKE EXECUTE ON FUNCTION public.<sig> FROM PUBLIC, anon;` for all seven;
  no new grant for the trigger/internal/cron functions; `authenticated`/`service_role` grants only where the
  caller matrix proves a real caller (today: none beyond the already-correct locked set).
- **Search paths:** exact `ALTER FUNCTION public.cleanup_expired_sessions() SET search_path = pg_catalog, public, pg_temp;`
  and the same for `expire_stale_sessions()`.
- **Migration behavior:** additive, idempotent (`REVOKE`/`ALTER FUNCTION … SET` are safe to re-run); no
  function body change; independent per function.
- **Rollback:** paired down-migration restoring the prior grants/search_path.
- **Falsification tests:** extend `secdef-classification-matrix.sql` so that after PR-B the seven functions
  assert **`anon = false`** and the two cleanup functions assert a pg_temp-safe `search_path` — the same
  harness that today proves they ARE exposed then proves they are not. Add a direct behavioral test that an
  `anon`-role `EXECUTE` of each remediated function is rejected.

## Ownership and parent
- Parent issue: #1097 · Increment: PR-A (read-only classification) · Refs #1097, does not close.
- No production query/mutation. The recording-lease caller question is resolved above (from call sites, not
  memory). Merge/apply/deploy remain separate PO gates; **no PR-B implementation until PR-A review fixes the
  target set.**
