-- P0.4 (review round 2) — make the owner-alert delivery SERVER-AUTHORITATIVE.
--
-- The browser must not be responsible for telling us feedback exists. This upgrades
-- report_alert_deliveries (from 20260720120000) into a full lease-based outbox:
--   * a TRIGGER enqueues a pending alert row at the DB persistence boundary (on report insert),
--   * reconcile_report_alerts() repairs any report missing an alert row,
--   * leases (lease_token + lease_expires_at + claimed_by) make claims crash-safe and reclaimable,
--   * max_attempts routes exhausted rows to a dead_letter terminal state with a deterministic replay.
-- A browser call becomes only a non-authoritative wake hint; the cron + reconciler guarantee delivery.
-- report_id stays the PRIMARY KEY, so exactly one alert per report (durable dedupe).

ALTER TABLE public.report_alert_deliveries
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by text,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS terminal_failed_at timestamptz,
  -- SNAPSHOT provenance AT REPORT CREATION (never re-resolved at delivery). A later registry
  -- expiry/change must not reclassify an already-enqueued alert; delayed/retried delivery reads these.
  ADD COLUMN IF NOT EXISTS data_origin text NOT NULL DEFAULT 'legacy_unclassified',
  ADD COLUMN IF NOT EXISTS cohort_id text,
  ADD COLUMN IF NOT EXISTS test_run_id text,
  ADD COLUMN IF NOT EXISTS test_suite text,
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'production';

-- Widen the status vocabulary to the full lifecycle.
ALTER TABLE public.report_alert_deliveries DROP CONSTRAINT IF EXISTS report_alert_deliveries_status_safe;
ALTER TABLE public.report_alert_deliveries ADD CONSTRAINT report_alert_deliveries_status_safe
  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dead_letter'));
ALTER TABLE public.report_alert_deliveries DROP CONSTRAINT IF EXISTS report_alert_deliveries_attempts_range;
ALTER TABLE public.report_alert_deliveries ADD CONSTRAINT report_alert_deliveries_attempts_range
  CHECK (attempt_count >= 0 AND max_attempts BETWEEN 1 AND 20);
ALTER TABLE public.report_alert_deliveries DROP CONSTRAINT IF EXISTS report_alert_deliveries_terminal_consistency;
ALTER TABLE public.report_alert_deliveries ADD CONSTRAINT report_alert_deliveries_terminal_consistency
  CHECK ((status = 'dead_letter' AND terminal_failed_at IS NOT NULL) OR (status <> 'dead_letter' AND terminal_failed_at IS NULL));

CREATE INDEX IF NOT EXISTS report_alert_deliveries_due_idx
  ON public.report_alert_deliveries (next_attempt_at) WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS report_alert_deliveries_lease_idx
  ON public.report_alert_deliveries (lease_expires_at) WHERE status = 'sending';

-- Explicit table privilege hardening (final migrated state; belt-and-suspenders over the RLS-no-policy
-- lock). Untrusted roles get NOTHING; the service role gets the minimum direct DML the worker needs.
-- (report_id is a uuid PK — no sequence is introduced, so no sequence grants are required.)
REVOKE ALL ON TABLE public.report_alert_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.report_alert_deliveries TO service_role;

-- (2) DB-boundary enqueue: every stored report gets a pending alert row. EXCEPTION-guarded so a queue
-- failure can never block report persistence.
CREATE OR REPLACE FUNCTION public.trg_enqueue_report_alert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_prov record;
BEGIN
  BEGIN
    -- Snapshot server-assigned provenance AT INSERT (anonymous/unregistered → legacy_unclassified).
    SELECT * INTO v_prov FROM public.resolve_actor_provenance(NEW.user_id);
    INSERT INTO public.report_alert_deliveries
      (report_id, status, attempt_count, next_attempt_at, data_origin, cohort_id, test_run_id, test_suite, environment)
    VALUES (NEW.id, 'pending', 0, now(),
      COALESCE(v_prov.data_origin, 'legacy_unclassified'), v_prov.cohort_id, v_prov.test_run_id, v_prov.test_suite, 'production')
    ON CONFLICT (report_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_report_alert_enqueue ON public.user_issue_reports;
CREATE TRIGGER trg_report_alert_enqueue
  AFTER INSERT ON public.user_issue_reports
  FOR EACH ROW EXECUTE FUNCTION public.trg_enqueue_report_alert();

-- Authoritative reconciliation: enqueue a pending alert row for any report missing one. Returns count.
CREATE OR REPLACE FUNCTION public.reconcile_report_alerts(p_since timestamptz DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_n integer;
BEGIN
  INSERT INTO public.report_alert_deliveries
    (report_id, status, attempt_count, next_attempt_at, data_origin, cohort_id, test_run_id, test_suite, environment)
  SELECT r.id, 'pending', 0, now(), p.data_origin, p.cohort_id, p.test_run_id, p.test_suite, 'production'
  FROM public.user_issue_reports r
  CROSS JOIN LATERAL public.resolve_actor_provenance(r.user_id) p
  WHERE (p_since IS NULL OR r.created_at >= p_since)
    AND NOT EXISTS (SELECT 1 FROM public.report_alert_deliveries d WHERE d.report_id = r.id)
  ON CONFLICT (report_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END; $$;

-- Replace the pre-lease claim/mark (20260720120000) with lease-based versions.
DROP FUNCTION IF EXISTS public.claim_report_alert(uuid);
DROP FUNCTION IF EXISTS public.mark_report_alert(uuid, text, text);

-- Targeted lease claim for ONE report (the wake-hint path): leases the row iff it is DUE
-- (pending/failed and next_attempt_at<=now) or its 'sending' lease has EXPIRED. Returns the lease
-- token (NULL if not claimable — already sent, in-flight, or dead-letter). Crash-safe + reclaimable.
CREATE OR REPLACE FUNCTION public.claim_report_alert(p_report_id uuid, p_worker text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_token uuid;
BEGIN
  UPDATE public.report_alert_deliveries d
    SET status='sending', attempt_count=d.attempt_count+1,
        lease_token=gen_random_uuid(), lease_expires_at=now()+interval '5 minutes', claimed_by=p_worker
    WHERE d.report_id=p_report_id
      AND ((d.status IN ('pending','failed') AND d.next_attempt_at<=now())
           OR (d.status='sending' AND d.lease_expires_at IS NOT NULL AND d.lease_expires_at<now()))
    RETURNING d.lease_token INTO v_token;
  RETURN v_token;
END; $$;

-- Batch drain claim (the cron worker): same due/expired logic across many rows, concurrency-safe.
CREATE OR REPLACE FUNCTION public.claim_report_alert_batch(p_limit integer DEFAULT 50, p_worker text DEFAULT NULL)
RETURNS SETOF public.report_alert_deliveries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_limit integer := LEAST(GREATEST(COALESCE(p_limit,50),1),200);
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT d.report_id FROM public.report_alert_deliveries d
    WHERE (d.status IN ('pending','failed') AND d.next_attempt_at<=now())
       OR (d.status='sending' AND d.lease_expires_at IS NOT NULL AND d.lease_expires_at<now())
    ORDER BY d.next_attempt_at FOR UPDATE SKIP LOCKED LIMIT v_limit
  )
  UPDATE public.report_alert_deliveries t
    SET status='sending', attempt_count=t.attempt_count+1,
        lease_token=gen_random_uuid(), lease_expires_at=now()+interval '5 minutes', claimed_by=p_worker
    FROM due WHERE t.report_id=due.report_id
    RETURNING t.*;
END; $$;

-- Lease-validated terminal mark. Never marks without the CURRENT unexpired lease. Validates inputs;
-- dead-letters at max_attempts; clears all lease fields; schedules bounded backoff on retryable failure.
CREATE OR REPLACE FUNCTION public.mark_report_alert(
  p_report_id uuid, p_lease_token uuid, p_status text, p_failure_category text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_attempts integer; v_max integer; v_updated integer;
BEGIN
  IF p_status NOT IN ('sent','failed') THEN RAISE EXCEPTION 'invalid status %', p_status; END IF;
  IF p_status='sent' AND p_failure_category IS NOT NULL THEN RAISE EXCEPTION 'sent must not carry a failure_category'; END IF;
  IF p_status='failed' AND (p_failure_category IS NULL OR p_failure_category NOT IN ('sentry_config_missing','sentry_ingest_rejected','transport_error','unknown'))
    THEN RAISE EXCEPTION 'failed requires an allowed failure_category (got %)', p_failure_category; END IF;

  SELECT attempt_count, max_attempts INTO v_attempts, v_max
    FROM public.report_alert_deliveries
    WHERE report_id=p_report_id AND status='sending' AND lease_token=p_lease_token AND lease_expires_at>now()
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF p_status='sent' THEN
    UPDATE public.report_alert_deliveries SET status='sent', failure_category=NULL, last_attempt_at=now(),
      lease_token=NULL, lease_expires_at=NULL, claimed_by=NULL WHERE report_id=p_report_id;
  ELSIF v_attempts >= v_max THEN
    UPDATE public.report_alert_deliveries SET status='dead_letter', failure_category=p_failure_category,
      terminal_failed_at=now(), last_attempt_at=now(), lease_token=NULL, lease_expires_at=NULL, claimed_by=NULL
      WHERE report_id=p_report_id;
  ELSE
    UPDATE public.report_alert_deliveries SET status='failed', failure_category=p_failure_category, last_attempt_at=now(),
      lease_token=NULL, lease_expires_at=NULL, claimed_by=NULL,
      next_attempt_at=now() + (LEAST(power(2, LEAST(v_attempts,6))::int,60) || ' minutes')::interval
      WHERE report_id=p_report_id;
  END IF;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END; $$;

-- Operator replay of a dead_letter alert (idempotent): back to pending; clears lease/terminal fields.
CREATE OR REPLACE FUNCTION public.replay_report_alert_deadletter(p_report_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_updated integer;
BEGIN
  UPDATE public.report_alert_deliveries
    SET status='pending', attempt_count=0, next_attempt_at=now(), terminal_failed_at=NULL, failure_category=NULL,
        lease_token=NULL, lease_expires_at=NULL, claimed_by=NULL
    WHERE report_id=p_report_id AND status='dead_letter';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END; $$;

-- Lock every alert RPC to service_role only.
REVOKE ALL ON FUNCTION public.reconcile_report_alerts(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_report_alert(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_report_alert_batch(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_report_alert(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replay_report_alert_deadletter(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_report_alerts(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_report_alert(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_report_alert_batch(integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_report_alert(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.replay_report_alert_deadletter(uuid) TO service_role;
