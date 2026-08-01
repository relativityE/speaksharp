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

## Narrow PR-B remediation set (proposal only — not to be coded until this target set is reviewed)

**Scope discipline:** remediate ONLY the confirmed defects below. Do **not** broaden into a general
`search_path` sweep of category B/C or unrelated hardening.

1. **`REVOKE EXECUTE … FROM PUBLIC` (and from `anon`)** on functions that have no legitimate anonymous
   caller: `cleanup_expired_sessions()`, `expire_stale_sessions()`, `update_user_usage(integer)`,
   `acquire_recording_lease(uuid,text,boolean)`, `heartbeat_recording_lease(uuid)`,
   `release_recording_lease(uuid)`, `ensure_trial_profile_for_new_user()`. Grant the minimum each real
   caller needs (`service_role` for the cleanup/cron workers; `authenticated` for the lease trio if the app
   calls them as an authenticated user; trigger functions need no EXECUTE grant at all).
2. **Set a safe `search_path`** on the two functions that have none —
   `cleanup_expired_sessions()` and `expire_stale_sessions()` — to `pg_catalog, public, pg_temp` (pg_temp
   last) or `''` with fully-qualified object references.

**Open question for review before PR-B coding:** confirm which real callers each anon-reachable function
legitimately has (esp. the recording-lease trio), so the minimum grant is correct rather than guessed.

### PR-B implementation packet (to be finalized after this target set is reviewed)
- **Functions & grants:** exact `REVOKE`/`GRANT` per function above.
- **Search paths:** exact `ALTER FUNCTION … SET search_path = …` for the two cleanup functions.
- **Migration behavior:** additive, idempotent (`REVOKE`/`GRANT` are safe to re-run); no function body change.
- **Rollback:** paired down-migration restoring prior grants/search_path.
- **Falsification tests:** extend this matrix to assert the remediated functions are **no longer**
  anon-executable and that the two cleanup functions carry a pg_temp-safe `search_path` — the same harness
  that today proves they ARE exposed will then prove they are not.

## Ownership and parent
- Parent issue: #1097 · Increment: PR-A (read-only classification) · Refs #1097, does not close.
- No production query/mutation. Merge/apply/deploy remain separate PO gates.
