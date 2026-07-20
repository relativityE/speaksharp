-- P0 (incident) — durable TELEMETRY OUTBOX for critical PostHog events.
--
-- Guarantee: "transactional enqueue when successful, automatic authoritative reconciliation when
-- enqueue fails." Supabase stays authoritative; a downstream PostHog/Sentry failure NEVER rolls back
-- or hides a saved session/report. The enqueue trigger is EXCEPTION-guarded so it can never block
-- persistence — and reconcile_telemetry_outbox() authoritatively repairs any session/report that is
-- missing an outbox row, so an enqueue failure is never silently unrecovered.
--
-- Idempotency: stable insert_id `<event_type>:<record_id>` + UNIQUE(event_type, record_id). The worker
-- MUST send this to PostHog as the `$insert_id` property (with the dollar prefix) so PostHog itself
-- also dedupes. Leases (lease_token + lease_expires_at) make claims crash-safe; max_attempts routes
-- exhausted rows to a dead_letter terminal state with an operator replay.

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
  -- Lease (crash-safe claim): a worker owns a row only while its token is current and unexpired.
  lease_token uuid,
  lease_expires_at timestamptz,
  claimed_by text,
  -- Server-assigned provenance (never client-chosen). client_release_sha is the browser-reported
  -- value (UNTRUSTED); server_verified_release_sha is filled by the trusted worker from deployment
  -- config. Never represent the client value as server-verified.
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
  CONSTRAINT telemetry_outbox_status_safe CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dead_letter')),
  CONSTRAINT telemetry_outbox_failure_safe CHECK (
    last_failure_category IS NULL OR last_failure_category IN ('config_missing', 'ingest_rejected', 'transport_error', 'unknown')
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

-- Enqueue helper — resolves server-assigned provenance and inserts idempotently. Wrapped by triggers
-- so a failure never rolls back persistence; reconcile repairs any gap.
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
SET search_path = public
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

-- Report trigger — EXCEPTION-guarded so the report insert survives an enqueue failure.
CREATE OR REPLACE FUNCTION public.trg_enqueue_report_telemetry()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

-- Session trigger — enqueue session_saved once the session reaches 'completed'.
CREATE OR REPLACE FUNCTION public.trg_enqueue_session_telemetry()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    BEGIN
      PERFORM public.enqueue_telemetry_event('session_saved', NEW.id, NEW.user_id, NEW.created_at, NULL);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_session_telemetry_outbox ON public.sessions;
CREATE TRIGGER trg_session_telemetry_outbox
  AFTER INSERT OR UPDATE OF status ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.trg_enqueue_session_telemetry();

-- Authoritative reconciliation: enqueue an outbox row for every completed session / report that is
-- missing one (idempotent via the unique claim). This is the guarantee that a swallowed enqueue is
-- never permanently lost. Returns the number of rows repaired.
CREATE OR REPLACE FUNCTION public.reconcile_telemetry_outbox(p_since timestamptz DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer := 0;
BEGIN
  INSERT INTO public.telemetry_outbox (event_type, record_id, insert_id, event_timestamp, data_origin, backfilled)
  SELECT 'session_saved', s.id, 'session_saved:' || s.id::text, s.created_at,
         public.resolve_data_origin(s.user_id), true
  FROM public.sessions s
  WHERE s.status = 'completed' AND (p_since IS NULL OR s.created_at >= p_since)
    AND NOT EXISTS (SELECT 1 FROM public.telemetry_outbox o WHERE o.event_type='session_saved' AND o.record_id=s.id)
  ON CONFLICT (event_type, record_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.telemetry_outbox (event_type, record_id, insert_id, event_timestamp, data_origin, backfilled)
  SELECT 'report_issue_submitted', r.id, 'report_issue_submitted:' || r.id::text, r.created_at,
         public.resolve_data_origin(r.user_id), true
  FROM public.user_issue_reports r
  WHERE (p_since IS NULL OR r.created_at >= p_since)
    AND NOT EXISTS (SELECT 1 FROM public.telemetry_outbox o WHERE o.event_type='report_issue_submitted' AND o.record_id=r.id)
  ON CONFLICT (event_type, record_id) DO NOTHING;
  GET DIAGNOSTICS v_count = v_count + ROW_COUNT;
  RETURN v_count;
END; $$;

-- Worker claim: clamp the limit, lease due rows (incl. reclaiming expired 'sending' leases), mark
-- them 'sending' with a fresh token, and return them. Concurrency-safe via FOR UPDATE SKIP LOCKED.
CREATE OR REPLACE FUNCTION public.claim_telemetry_batch(p_limit integer DEFAULT 50, p_worker text DEFAULT NULL)
RETURNS SETOF public.telemetry_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

-- Worker mark: validate inputs, require the CURRENT lease token (a stale worker can't mark a
-- reclaimed row), then terminal 'sent', bounded-backoff 'failed', or 'dead_letter' at max_attempts.
CREATE OR REPLACE FUNCTION public.mark_telemetry_result(
  p_id uuid, p_lease_token uuid, p_status text, p_failure_category text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_attempts integer; v_max integer; v_updated integer;
BEGIN
  IF p_status NOT IN ('sent', 'failed') THEN RAISE EXCEPTION 'invalid status %', p_status; END IF;
  IF p_failure_category IS NOT NULL AND p_failure_category NOT IN ('config_missing','ingest_rejected','transport_error','unknown')
    THEN RAISE EXCEPTION 'invalid failure_category %', p_failure_category; END IF;

  SELECT attempt_count, max_attempts INTO v_attempts, v_max
    FROM public.telemetry_outbox WHERE id = p_id AND lease_token = p_lease_token FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF; -- stale/none: caller lost the lease

  IF p_status = 'sent' THEN
    UPDATE public.telemetry_outbox SET status='sent', last_failure_category=NULL, lease_token=NULL, lease_expires_at=NULL WHERE id=p_id;
  ELSIF v_attempts >= v_max THEN
    UPDATE public.telemetry_outbox
      SET status='dead_letter', last_failure_category=p_failure_category, terminal_failed_at=now(), lease_token=NULL, lease_expires_at=NULL
      WHERE id=p_id;
  ELSE
    UPDATE public.telemetry_outbox
      SET status='failed', last_failure_category=p_failure_category, lease_token=NULL, lease_expires_at=NULL,
          next_retry_at = now() + (LEAST(power(2, LEAST(v_attempts, 6))::int, 60) || ' minutes')::interval
      WHERE id=p_id;
  END IF;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END; $$;

-- Operator replay of a dead_letter row (explicit, idempotent): back to pending, attempts reset.
CREATE OR REPLACE FUNCTION public.replay_telemetry_deadletter(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_updated integer;
BEGIN
  UPDATE public.telemetry_outbox
    SET status='pending', attempt_count=0, next_retry_at=now(), terminal_failed_at=NULL, last_failure_category=NULL,
        lease_token=NULL, lease_expires_at=NULL
    WHERE id=p_id AND status='dead_letter';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END; $$;

-- Lock down every RPC to the service role (worker) only.
REVOKE ALL ON FUNCTION public.enqueue_telemetry_event(text, uuid, uuid, timestamptz, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_telemetry_outbox(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_telemetry_batch(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_telemetry_result(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replay_telemetry_deadletter(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_telemetry_event(text, uuid, uuid, timestamptz, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_telemetry_outbox(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_telemetry_batch(integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_telemetry_result(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.replay_telemetry_deadletter(uuid) TO service_role;
