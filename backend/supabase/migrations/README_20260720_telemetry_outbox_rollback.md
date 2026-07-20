# Forward-rollback analysis — P0 telemetry-outbox foundation (2026-07-20)

Migrations in scope (apply order):

1. `20260720140000_report_session_ownership_guard.sql` — `enforce_report_session_ownership()` + trigger.
   **SECURITY BOUNDARY — see the carve-out below. NOT part of telemetry-delivery rollback.**
2. `20260720150000_observability_provenance_registry.sql` — `observability_actor_registry` table + `resolve_data_origin()` / `resolve_actor_provenance()`.
3. `20260720150100_telemetry_outbox.sql` — `telemetry_outbox` table, enqueue/report/session triggers, `reconcile_telemetry_outbox()`, `reconcile_telemetry_candidates()`, `claim_telemetry_batch()`, `mark_telemetry_result()`, `discard_telemetry_event()`, `replay_telemetry_deadletter()`, `operator_telemetry_delivery_status()`.

## ⚠️ Security carve-out — the ownership guard is NOT rolled back with telemetry

`trg_enforce_report_session_ownership` / `enforce_report_session_ownership()` (migration #1) is an
**independent security boundary**: it prevents a report from being associated with another account's
session (cross-account association). It is unrelated to telemetry delivery and it was a pre-existing
vulnerability fix. **Rolling back telemetry delivery MUST NOT disable or drop this trigger** — doing so
reopens the cross-account vulnerability. Any change to the ownership guard is a SEPARATE decision that
requires its own security justification and review, never a side effect of withdrawing telemetry. It
does not appear in any step below.

## Principle

**Rollback is FORWARD-only and NON-DESTRUCTIVE.** Supabase stays authoritative; the outbox is a
delivery ledger. Undelivered (`pending`/`failed`) and terminal (`dead_letter`) rows are the record of
telemetry we still owe or failed to deliver — they are evidence, not garbage. A rollback must never
delete them. If the foundation must be withdrawn, **export the outbox first**, then remove structure.

## Export sensitivity — protected pseudonymous identifiers

The outbox has no prose/transcript/email columns, but `record_id`, `test_run_id`, `cohort_id`, and
`insert_id` (which embeds `record_id`) are **protected PSEUDONYMOUS identifiers** — "no prose" does NOT
mean the export is non-sensitive. Any export:

- MUST go to durable, ACCESS-CONTROLLED audit storage (ops-only), NEVER a public or ordinary CI
  artifact, PR comment, or general log.
- MUST NOT be attached to this repo, the incident PR, or any workflow-uploaded artifact.
- Is handled under the same care as other pseudonymous account data.

## Ordered rollback procedure (safe) — telemetry delivery only

Do these in order. Each step is independently reversible until step 5.

1. **Stop the schedule/worker first.** Disable the cron/edge invocation so nothing claims new rows.
   Nothing below is safe while a worker is mid-lease.
2. **Disable the telemetry ENQUEUE triggers only** (stop new rows entering the ledger) BEFORE touching
   functions. Do NOT touch the ownership guard trigger (security carve-out above):
   ```sql
   ALTER TABLE public.sessions            DISABLE TRIGGER trg_session_telemetry_outbox;
   ALTER TABLE public.user_issue_reports  DISABLE TRIGGER trg_report_telemetry_outbox;
   -- trg_enforce_report_session_ownership stays ENABLED — it is a security boundary, not telemetry.
   ```
   Persistence is unaffected — the enqueue triggers are `AFTER` and EXCEPTION-guarded; disabling them
   only stops enqueue. Sessions and reports keep saving, and cross-account protection stays intact.
3. **Revoke telemetry RPC access** so no caller (even service_role) can claim/mark/discard during
   teardown:
   ```sql
   REVOKE EXECUTE ON FUNCTION public.claim_telemetry_batch(integer, text)      FROM service_role;
   REVOKE EXECUTE ON FUNCTION public.mark_telemetry_result(uuid, uuid, text, text, text) FROM service_role;
   REVOKE EXECUTE ON FUNCTION public.discard_telemetry_event(uuid, uuid)       FROM service_role;
   REVOKE EXECUTE ON FUNCTION public.enqueue_telemetry_event(text, uuid, uuid, timestamptz, text, boolean) FROM service_role;
   -- reconcile_* / replay / operator_telemetry_delivery_status may be retained read-for-audit if desired.
   ```
4. **Export undelivered + terminal rows** to ACCESS-CONTROLLED audit storage BEFORE any drop (see
   "Export sensitivity" — never a public/CI artifact). Evidence-preservation gate; do not proceed to
   step 5 until the export is confirmed:
   ```sql
   COPY (SELECT id, event_type, record_id, insert_id, status, attempt_count, max_attempts,
                last_failure_category, terminal_failed_at, event_timestamp, data_origin, cohort_id,
                test_run_id, test_suite, client_release_sha, server_verified_release_sha,
                environment, backfilled, created_at
         FROM public.telemetry_outbox
         WHERE status IN ('pending','failed','sending','dead_letter','discarded'))
     TO STDOUT WITH CSV HEADER;
   ```
5. **Only after a confirmed export**, remove telemetry structure. Functions and the table drop cleanly
   (the outbox has no inbound FKs; the registry cascades from `auth.users`). The ownership guard is
   deliberately ABSENT from this list:
   ```sql
   DROP FUNCTION IF EXISTS public.operator_telemetry_delivery_status(uuid);
   DROP FUNCTION IF EXISTS public.discard_telemetry_event(uuid, uuid);
   DROP FUNCTION IF EXISTS public.replay_telemetry_deadletter(uuid);
   DROP FUNCTION IF EXISTS public.mark_telemetry_result(uuid, uuid, text, text, text);
   DROP FUNCTION IF EXISTS public.claim_telemetry_batch(integer, text);
   DROP FUNCTION IF EXISTS public.reconcile_telemetry_candidates(timestamptz);
   DROP FUNCTION IF EXISTS public.reconcile_telemetry_outbox(timestamptz);
   DROP FUNCTION IF EXISTS public.enqueue_telemetry_event(text, uuid, uuid, timestamptz, text, boolean);
   DROP TRIGGER  IF EXISTS trg_session_telemetry_outbox ON public.sessions;
   DROP TRIGGER  IF EXISTS trg_report_telemetry_outbox  ON public.user_issue_reports;
   DROP FUNCTION IF EXISTS public.trg_enqueue_session_telemetry();
   DROP FUNCTION IF EXISTS public.trg_enqueue_report_telemetry();
   DROP TABLE    IF EXISTS public.telemetry_outbox;              -- ONLY after step-4 export
   -- Provenance registry (optional; keep if any classified assignments must persist):
   DROP FUNCTION IF EXISTS public.resolve_actor_provenance(uuid);
   DROP FUNCTION IF EXISTS public.resolve_data_origin(uuid);
   DROP TABLE    IF EXISTS public.observability_actor_registry;  -- export assignments first if kept
   -- trg_enforce_report_session_ownership / enforce_report_session_ownership() are NOT dropped here.
   ```

## Explicitly PROHIBITED rollback actions

- **Never** disable or drop `trg_enforce_report_session_ownership` as part of a telemetry rollback — it
  is a separate security boundary (reopens cross-account association).
- **Never** `DELETE FROM telemetry_outbox WHERE status IN ('pending','failed','dead_letter','discarded')`
  — that destroys undelivered/failed/tombstone evidence. Truncating or dropping the table before the
  step-4 export is the same violation.
- **Never** upload the step-4 export as a public or ordinary CI artifact — it carries protected
  pseudonymous identifiers.
- **Never** drop functions/triggers while the worker is still running (races an in-flight lease).
- **Never** treat dropping the registry as a way to "reset" provenance — export assignments first; a
  lost registry silently reclassifies future rows to `legacy_unclassified`.

## Partial rollback (keep the ledger, withdraw only delivery)

If the intent is merely to pause delivery (not remove the foundation), stop at **steps 1–3**. Rows
accumulate safely in `pending`; when re-enabled, `reconcile_telemetry_outbox()` + the worker drain the
backlog with idempotent `$insert_id` dedupe. No data is lost and no rollback of structure is needed.
