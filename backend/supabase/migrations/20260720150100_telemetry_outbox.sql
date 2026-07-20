-- P0 (incident) — durable TELEMETRY OUTBOX for critical PostHog events.
--
-- Guarantee: authoritative reconciliation FUNCTION implemented; AUTOMATIC recovery is pending the
-- worker/schedule that calls it before every claim (until then, recovery is not automatic). Supabase
-- stays authoritative; a downstream PostHog/Sentry failure NEVER rolls back or hides a saved
-- session/report. The enqueue trigger is EXCEPTION-guarded so it can never block persistence, and
-- reconcile_telemetry_outbox() authoritatively repairs any session/report missing an outbox row.
--
-- Idempotency: stable insert_id `<event_type>:<record_id>` + UNIQUE(event_type, record_id). The worker
-- MUST send this to PostHog as the `$insert_id` property (dollar prefix) so PostHog also dedupes.
-- Leases (lease_token + lease_expires_at) make claims crash-safe; max_attempts routes exhausted rows
-- to a dead_letter terminal state with an operator replay.

CREATE TABLE IF NOT EXISTS public.telemetry_outbox (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type text NOT NULL,
  record_id uuid NOT NULL,
  insert_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  last_failure_category text,
  terminal_failed_at timestamptz,
  event_timestamp timestamptz NOT NULL,
  lease_token uuid,
  lease_expires_at timestamptz,
  claimed_by text,
  -- Server-assigned provenance (never client-chosen). client_release_sha = browser-reported
  -- (UNTRUSTED); server_verified_release_sha = worker-filled from deployment config.
  data_origin text NOT NULL DEFAULT 'legacy_unclassified',
  cohort_id text,
  test_run_id text,
  test_suite text,
  client_release_sha text,
  server_verified_release_sha text,
  environment text NOT NULL DEFAULT 'production',
  backfilled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telemetry_outbox_event_type_safe CHECK (event_type IN ('session_saved', 'report_issue_submitted')),
  -- 'discarded' = terminal, non-retryable disposition for an event whose authoritative source row is
  -- gone (deleted account/session) — a privacy-safe tombstone, NOT a delivery and NOT a failure.
  CONSTRAINT telemetry_outbox_status_safe CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dead_letter', 'discarded')),
  CONSTRAINT telemetry_outbox_failure_safe CHECK (
    last_failure_category IS NULL OR last_failure_category IN ('config_missing', 'ingest_rejected', 'transport_error', 'unknown')
  ),
  CONSTRAINT telemetry_outbox_data_origin_safe CHECK (
    data_origin IN ('automated_test', 'seed_fixture', 'owner_manual_test', 'beta_tester', 'production_user', 'synthetic_monitor', 'legacy_unclassified')
  ),
  CONSTRAINT telemetry_outbox_attempts_nonneg CHECK (attempt_count >= 0),
  CONSTRAINT telemetry_outbox_max_attempts_range CHECK (max_attempts BETWEEN 1 AND 20),
  -- terminal_failed_at present iff a terminal-with-timestamp state (dead_letter or discarded).
  CONSTRAINT telemetry_outbox_terminal_consistency CHECK (
    (status IN ('dead_letter', 'discarded') AND terminal_failed_at IS NOT NULL)
    OR (status NOT IN ('dead_letter', 'discarded') AND terminal_failed_at IS NULL)
  ),
  CONSTRAINT telemetry_outbox_dedupe UNIQUE (event_type, record_id)
);

ALTER TABLE public.telemetry_outbox ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: service-role (worker) only. No prose/transcript/PII columns exist here.
REVOKE ALL ON TABLE public.telemetry_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.telemetry_outbox TO service_role;

CREATE INDEX IF NOT EXISTS telemetry_outbox_due_idx
  ON public.telemetry_outbox (next_retry_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS telemetry_outbox_lease_idx
  ON public.telemetry_outbox (lease_expires_at)
  WHERE status = 'sending';

-- Enqueue helper — resolves server-assigned provenance (all four marker fields) and inserts
-- idempotently. Wrapped by triggers so a failure never rolls back persistence; reconcile repairs gaps.
CREATE OR REPLACE FUNCTION public.enqueue_telemetry_event(
  p_event_type text,
  p_record_id uuid,
  p_user_id uuid,
  p_event_timestamp timestamptz,
  p_client_release_sha text,
  p_backfilled boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prov record;
BEGIN
  SELECT * INTO v_prov FROM public.resolve_actor_provenance(p_user_id);
  INSERT INTO public.telemetry_outbox (
    event_type, record_id, insert_id, event_timestamp,
    data_origin, cohort_id, test_run_id, test_suite, client_release_sha, backfilled
  ) VALUES (
    p_event_type, p_record_id, p_event_type || ':' || p_record_id::text, p_event_timestamp,
    COALESCE(v_prov.data_origin, 'legacy_unclassified'), v_prov.cohort_id, v_prov.test_run_id, v_prov.test_suite,
    p_client_release_sha, p_backfilled
  )
  ON CONFLICT (event_type, record_id) DO NOTHING;
END;
$$;

-- Report trigger — EXCEPTION-guarded. Report event_timestamp = created_at; client SHA from metadata.
CREATE OR REPLACE FUNCTION public.trg_enqueue_report_telemetry()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  BEGIN
    PERFORM public.enqueue_telemetry_event(
      'report_issue_submitted', NEW.id, NEW.user_id, NEW.created_at,
      NULLIF(NEW.metadata->'appRuntimeConfig'->>'release', '')
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_report_telemetry_outbox ON public.user_issue_reports;
CREATE TRIGGER trg_report_telemetry_outbox
  AFTER INSERT ON public.user_issue_reports
  FOR EACH ROW EXECUTE FUNCTION public.trg_enqueue_report_telemetry();

-- Session trigger — session_saved when a session reaches 'completed'. event_timestamp = the
-- COMPLETION time (updated_at), not the row creation time. No authoritative client SHA source → NULL.
CREATE OR REPLACE FUNCTION public.trg_enqueue_session_telemetry()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    BEGIN
      PERFORM public.enqueue_telemetry_event('session_saved', NEW.id, NEW.user_id,
        COALESCE(NEW.updated_at, NEW.created_at), NULL);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_session_telemetry_outbox ON public.sessions;
CREATE TRIGGER trg_session_telemetry_outbox
  AFTER INSERT OR UPDATE OF status ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.trg_enqueue_session_telemetry();

-- Dry-run: count reconciliation CANDIDATES (completed sessions / reports missing an outbox row) within
-- a boundary, WITHOUT inserting anything. This is the required pre-flight before any backfill so the
-- operator sees exact candidate counts (and can classify provenance) before a single event is enqueued
-- or delivered. p_since NULL = full history (use ONLY for an explicit owner-approved one-time count).
CREATE OR REPLACE FUNCTION public.reconcile_telemetry_candidates(p_since timestamptz DEFAULT NULL)
RETURNS TABLE (event_type text, candidate_count bigint, unclassified_count bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public STABLE AS $$
  SELECT 'session_saved', count(*),
         count(*) FILTER (WHERE public.resolve_data_origin(s.user_id) = 'legacy_unclassified')
  FROM public.sessions s
  WHERE s.status = 'completed' AND (p_since IS NULL OR s.created_at >= p_since)
    AND NOT EXISTS (SELECT 1 FROM public.telemetry_outbox o WHERE o.event_type='session_saved' AND o.record_id=s.id)
  UNION ALL
  SELECT 'report_issue_submitted', count(*),
         count(*) FILTER (WHERE public.resolve_data_origin(r.user_id) = 'legacy_unclassified')
  FROM public.user_issue_reports r
  WHERE (p_since IS NULL OR r.created_at >= p_since)
    AND NOT EXISTS (SELECT 1 FROM public.telemetry_outbox o WHERE o.event_type='report_issue_submitted' AND o.record_id=r.id);
$$;

-- Authoritative reconciliation: enqueue an outbox row for every completed session / report missing one
-- WITHIN A BOUNDARY, preserving the ORIGINAL event timestamp, full provenance (all four marker
-- fields), backfilled flag, and (reports only) the untrusted client SHA from metadata. Returns rows
-- repaired. BOUNDARY POLICY: the worker passes a bounded rolling window every run (never NULL). p_since
-- NULL scans ALL history and must be used ONLY for an explicit, owner-approved one-time backfill (the
-- incident backfill uses the recorded invitation boundary 2026-07-18T17:43:56Z). Always run
-- reconcile_telemetry_candidates() first and review the counts before an unbounded call.
CREATE OR REPLACE FUNCTION public.reconcile_telemetry_outbox(p_since timestamptz DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_count integer := 0; v_n integer;
BEGIN
  INSERT INTO public.telemetry_outbox
    (event_type, record_id, insert_id, event_timestamp, data_origin, cohort_id, test_run_id, test_suite, client_release_sha, backfilled)
  SELECT 'session_saved', s.id, 'session_saved:' || s.id::text,
         COALESCE(s.updated_at, s.created_at),
         p.data_origin, p.cohort_id, p.test_run_id, p.test_suite,
         NULL, true
  FROM public.sessions s
  CROSS JOIN LATERAL public.resolve_actor_provenance(s.user_id) p
  WHERE s.status = 'completed' AND (p_since IS NULL OR s.created_at >= p_since)
    AND NOT EXISTS (SELECT 1 FROM public.telemetry_outbox o WHERE o.event_type='session_saved' AND o.record_id=s.id)
  ON CONFLICT (event_type, record_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;

  INSERT INTO public.telemetry_outbox
    (event_type, record_id, insert_id, event_timestamp, data_origin, cohort_id, test_run_id, test_suite, client_release_sha, backfilled)
  SELECT 'report_issue_submitted', r.id, 'report_issue_submitted:' || r.id::text,
         r.created_at,
         p.data_origin, p.cohort_id, p.test_run_id, p.test_suite,
         NULLIF(r.metadata->'appRuntimeConfig'->>'release', ''), true
  FROM public.user_issue_reports r
  CROSS JOIN LATERAL public.resolve_actor_provenance(r.user_id) p
  WHERE (p_since IS NULL OR r.created_at >= p_since)
    AND NOT EXISTS (SELECT 1 FROM public.telemetry_outbox o WHERE o.event_type='report_issue_submitted' AND o.record_id=r.id)
  ON CONFLICT (event_type, record_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;
  RETURN v_count;
END; $$;

-- Worker claim: clamp limit, lease due rows (incl. reclaiming EXPIRED 'sending' leases), mark
-- 'sending' with a fresh token + owner, return them. Concurrency-safe via FOR UPDATE SKIP LOCKED.
CREATE OR REPLACE FUNCTION public.claim_telemetry_batch(p_limit integer DEFAULT 50, p_worker text DEFAULT NULL)
RETURNS SETOF public.telemetry_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT o.id FROM public.telemetry_outbox o
    WHERE (o.status IN ('pending', 'failed') AND o.next_retry_at <= now())
       OR (o.status = 'sending' AND o.lease_expires_at IS NOT NULL AND o.lease_expires_at < now())
    ORDER BY o.next_retry_at
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  )
  UPDATE public.telemetry_outbox t
    SET status = 'sending',
        attempt_count = t.attempt_count + 1,
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + interval '5 minutes',
        claimed_by = p_worker
    FROM due WHERE t.id = due.id
    RETURNING t.*;
END; $$;

-- PROOF-ONLY claim: leases EXACTLY ONE outbox row identified by (record_id, event_type), and ONLY if
-- its server-assigned data_origin is 'automated_test'. It refuses any non-automated_test row (returns
-- nothing) and cannot touch any other record. This lets a pre-cutover proof deliver a single synthetic
-- row WITHOUT running normal reconciliation/draining that could claim a real tester's pending record.
CREATE OR REPLACE FUNCTION public.claim_telemetry_proof_row(p_record_id uuid, p_event_type text, p_worker text DEFAULT 'proof')
RETURNS SETOF public.telemetry_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN QUERY
  UPDATE public.telemetry_outbox t
    SET status='sending', attempt_count=t.attempt_count+1,
        lease_token=gen_random_uuid(), lease_expires_at=now()+interval '5 minutes', claimed_by=p_worker
    WHERE t.record_id=p_record_id AND t.event_type=p_event_type
      AND t.data_origin='automated_test'   -- REFUSE beta_tester/owner_manual_test/production_user/legacy_unclassified
      AND ((t.status IN ('pending','failed') AND t.next_retry_at<=now())
           OR (t.status='sending' AND t.lease_expires_at IS NOT NULL AND t.lease_expires_at<now()))
    RETURNING t.*;
END; $$;

-- Worker mark: a worker owns the row ONLY while its lease is unexpired. Validates inputs strictly and
-- clears ALL lease fields (token, expiry, claimed_by) on every transition. On 'sent' it persists the
-- worker's OWN deployment SHA as server_verified_release_sha (trusted, server-side) — this value is
-- NEVER a client-supplied SHA; the trusted worker passes its deploy SHA through this DEFINER RPC.
CREATE OR REPLACE FUNCTION public.mark_telemetry_result(
  p_id uuid, p_lease_token uuid, p_status text, p_failure_category text,
  p_server_verified_release_sha text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_attempts integer; v_max integer; v_updated integer;
BEGIN
  IF p_status NOT IN ('sent', 'failed') THEN RAISE EXCEPTION 'invalid status %', p_status; END IF;
  IF p_status = 'sent' AND p_failure_category IS NOT NULL THEN RAISE EXCEPTION 'sent must not carry a failure_category'; END IF;
  IF p_status = 'failed' AND (p_failure_category IS NULL OR p_failure_category NOT IN ('config_missing','ingest_rejected','transport_error','unknown'))
    THEN RAISE EXCEPTION 'failed requires an allowed failure_category (got %)', p_failure_category; END IF;

  -- Ownership requires the CURRENT, UNEXPIRED lease on a row still in 'sending'.
  SELECT attempt_count, max_attempts INTO v_attempts, v_max
    FROM public.telemetry_outbox
    WHERE id = p_id AND status = 'sending' AND lease_token = p_lease_token AND lease_expires_at > now()
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF p_status = 'sent' THEN
    UPDATE public.telemetry_outbox SET status='sent', last_failure_category=NULL,
      server_verified_release_sha = COALESCE(p_server_verified_release_sha, server_verified_release_sha),
      lease_token=NULL, lease_expires_at=NULL, claimed_by=NULL WHERE id=p_id;
  ELSIF v_attempts >= v_max THEN
    UPDATE public.telemetry_outbox SET status='dead_letter', last_failure_category=p_failure_category,
      terminal_failed_at=now(), lease_token=NULL, lease_expires_at=NULL, claimed_by=NULL WHERE id=p_id;
  ELSE
    UPDATE public.telemetry_outbox SET status='failed', last_failure_category=p_failure_category,
      lease_token=NULL, lease_expires_at=NULL, claimed_by=NULL,
      next_retry_at = now() + (LEAST(power(2, LEAST(v_attempts, 6))::int, 60) || ' minutes')::interval
      WHERE id=p_id;
  END IF;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END; $$;

-- Worker discard: terminal, non-retryable disposition for an event whose authoritative SOURCE ROW is
-- gone (deleted account/session) — we must NOT resurrect deleted-user telemetry, and must NOT retry
-- forever to dead-letter. Requires the current unexpired lease. Clears all lease fields.
CREATE OR REPLACE FUNCTION public.discard_telemetry_event(p_id uuid, p_lease_token uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_updated integer;
BEGIN
  UPDATE public.telemetry_outbox
    SET status='discarded', terminal_failed_at=now(), last_failure_category=NULL,
        lease_token=NULL, lease_expires_at=NULL, claimed_by=NULL
    WHERE id=p_id AND status='sending' AND lease_token=p_lease_token AND lease_expires_at > now();
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END; $$;

-- Operator replay of a dead_letter row (explicit, idempotent): back to pending; clears lease fields.
CREATE OR REPLACE FUNCTION public.replay_telemetry_deadletter(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_updated integer;
BEGIN
  UPDATE public.telemetry_outbox
    SET status='pending', attempt_count=0, next_retry_at=now(), terminal_failed_at=NULL, last_failure_category=NULL,
        lease_token=NULL, lease_expires_at=NULL, claimed_by=NULL
    WHERE id=p_id AND status='dead_letter';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END; $$;

-- OPERATOR/SERVICE delivery-status RPC (NOT owner-facing). Sanitized per-account DELIVERY COUNTS for
-- ops/support to answer "did this account's telemetry get delivered?". It is service-role-only and
-- returns COUNTS ONLY (event_type × status) — it does NOT return report content and is NOT directly
-- callable by an authenticated owner. Authenticated owner retrieval of the full report (by report id,
-- with ownership authorization + receipt) is a SEPARATE product surface (see the report service /
-- report-issue-alert integration), not this function. The outbox is keyed by record_id (no user_id
-- column, to stay PII-minimal), so this joins back to the authoritative tables to scope by account.
CREATE OR REPLACE FUNCTION public.operator_telemetry_delivery_status(p_user_id uuid)
RETURNS TABLE (event_type text, status text, n bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public STABLE AS $$
  SELECT o.event_type, o.status, count(*) AS n
  FROM public.telemetry_outbox o
  WHERE (o.event_type = 'session_saved'
           AND EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = o.record_id AND s.user_id = p_user_id))
     OR (o.event_type = 'report_issue_submitted'
           AND EXISTS (SELECT 1 FROM public.user_issue_reports r WHERE r.id = o.record_id AND r.user_id = p_user_id))
  GROUP BY o.event_type, o.status;
$$;

-- Lock down every RPC to the service role (worker) only.
REVOKE ALL ON FUNCTION public.enqueue_telemetry_event(text, uuid, uuid, timestamptz, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_telemetry_outbox(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_telemetry_candidates(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_telemetry_batch(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_telemetry_proof_row(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_telemetry_result(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replay_telemetry_deadletter(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.discard_telemetry_event(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.operator_telemetry_delivery_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_telemetry_event(text, uuid, uuid, timestamptz, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_telemetry_outbox(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_telemetry_candidates(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_telemetry_batch(integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_telemetry_proof_row(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_telemetry_result(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.replay_telemetry_deadletter(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.discard_telemetry_event(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.operator_telemetry_delivery_status(uuid) TO service_role;
