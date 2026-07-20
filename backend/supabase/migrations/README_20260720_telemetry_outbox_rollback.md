# Forward-rollback analysis — P0 telemetry-outbox foundation (2026-07-20)

Migrations in scope (apply order):

1. `20260720140000_report_session_ownership_guard.sql` — `enforce_report_session_ownership()` + trigger.
2. `20260720150000_observability_provenance_registry.sql` — `observability_actor_registry` table + `resolve_data_origin()` / `resolve_actor_provenance()`.
3. `20260720150100_telemetry_outbox.sql` — `telemetry_outbox` table, enqueue/report/session triggers, `reconcile_telemetry_outbox()`, `claim_telemetry_batch()`, `mark_telemetry_result()`, `replay_telemetry_deadletter()`.

## Principle

**Rollback is FORWARD-only and NON-DESTRUCTIVE.** Supabase stays authoritative; the outbox is a
delivery ledger. Undelivered (`pending`/`failed`) and terminal (`dead_letter`) rows are the record of
telemetry we still owe or failed to deliver — they are evidence, not garbage. A rollback must never
delete them. If the foundation must be withdrawn, **export the outbox first**, then remove structure.

## Ordered rollback procedure (safe)

Do these in order. Each step is independently reversible until step 5.

1. **Stop the schedule/worker first.** Disable the cron/edge invocation so nothing claims new rows.
   Nothing below is safe while a worker is mid-lease.
2. **Disable the enqueue triggers** (stop new rows entering the ledger) BEFORE touching functions:
   ```sql
   ALTER TABLE public.sessions            DISABLE TRIGGER trg_session_telemetry_outbox;
   ALTER TABLE public.user_issue_reports  DISABLE TRIGGER trg_report_telemetry_outbox;
   ALTER TABLE public.user_issue_reports  DISABLE TRIGGER trg_enforce_report_session_ownership;
   ```
   Persistence is unaffected — the triggers are `AFTER`/`BEFORE` and EXCEPTION-guarded; disabling them
   only stops enqueue and ownership coercion. Sessions and reports keep saving.
3. **Revoke RPC access** so no caller (even service_role) can claim/mark/replay during teardown:
   ```sql
   REVOKE EXECUTE ON FUNCTION public.claim_telemetry_batch(integer, text)      FROM service_role;
   REVOKE EXECUTE ON FUNCTION public.mark_telemetry_result(uuid, uuid, text, text, text) FROM service_role;
   REVOKE EXECUTE ON FUNCTION public.enqueue_telemetry_event(text, uuid, uuid, timestamptz, text, boolean) FROM service_role;
   -- reconcile_telemetry_outbox / replay_telemetry_deadletter may be retained read-for-audit if desired.
   ```
4. **Export undelivered + dead-letter rows** to durable audit storage BEFORE any drop. This is the
   evidence-preservation gate — do not proceed to step 5 until the export is confirmed:
   ```sql
   COPY (SELECT id, event_type, record_id, insert_id, status, attempt_count, max_attempts,
                last_failure_category, terminal_failed_at, event_timestamp, data_origin, cohort_id,
                test_run_id, test_suite, client_release_sha, server_verified_release_sha,
                environment, backfilled, created_at
         FROM public.telemetry_outbox
         WHERE status IN ('pending','failed','sending','dead_letter'))
     TO STDOUT WITH CSV HEADER;
   ```
   (No prose/transcript/PII columns exist in this table, so the export is content-free by construction.)
5. **Only after a confirmed export**, remove structure. Functions and tables drop cleanly because the
   outbox has no inbound FKs and the registry cascades from `auth.users`:
   ```sql
   DROP FUNCTION IF EXISTS public.telemetry_delivery_status(uuid);
   DROP FUNCTION IF EXISTS public.replay_telemetry_deadletter(uuid);
   DROP FUNCTION IF EXISTS public.mark_telemetry_result(uuid, uuid, text, text, text);
   DROP FUNCTION IF EXISTS public.claim_telemetry_batch(integer, text);
   DROP FUNCTION IF EXISTS public.reconcile_telemetry_outbox(timestamptz);
   DROP FUNCTION IF EXISTS public.enqueue_telemetry_event(text, uuid, uuid, timestamptz, text, boolean);
   DROP TRIGGER  IF EXISTS trg_session_telemetry_outbox ON public.sessions;
   DROP TRIGGER  IF EXISTS trg_report_telemetry_outbox  ON public.user_issue_reports;
   DROP FUNCTION IF EXISTS public.trg_enqueue_session_telemetry();
   DROP FUNCTION IF EXISTS public.trg_enqueue_report_telemetry();
   DROP TABLE    IF EXISTS public.telemetry_outbox;              -- ONLY after step-4 export
   DROP TRIGGER  IF EXISTS trg_enforce_report_session_ownership ON public.user_issue_reports;
   DROP FUNCTION IF EXISTS public.enforce_report_session_ownership();
   DROP FUNCTION IF EXISTS public.resolve_actor_provenance(uuid);
   DROP FUNCTION IF EXISTS public.resolve_data_origin(uuid);
   DROP TABLE    IF EXISTS public.observability_actor_registry;  -- provenance assignments; export if kept
   ```

## Explicitly PROHIBITED rollback actions

- **Never** `DELETE FROM telemetry_outbox WHERE status IN ('pending','failed','dead_letter')` — that
  destroys undelivered/failed evidence. Truncating or dropping the table before step-4 export is the
  same violation.
- **Never** drop functions/triggers while the worker is still running (races an in-flight lease).
- **Never** treat dropping the registry as a way to "reset" provenance — export assignments first; a
  lost registry silently reclassifies future rows to `legacy_unclassified`.

## Partial rollback (keep the ledger, withdraw only delivery)

If the intent is merely to pause delivery (not remove the foundation), stop at **steps 1–3**. Rows
accumulate safely in `pending`; when re-enabled, `reconcile_telemetry_outbox()` + the worker drain the
backlog with idempotent `$insert_id` dedupe. No data is lost and no rollback of structure is needed.
