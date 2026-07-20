-- P0 (incident) — durable transactional TELEMETRY OUTBOX for critical PostHog events.
--
-- Root cause proven for the direct client capture paths: posthog.capture() is invoked but no capture
-- request is emitted, so session_saved / report_issue_submitted can silently never reach PostHog even
-- though the row IS persisted in Supabase. Fix: enqueue an outbox row transactionally at the
-- persistence boundary; a server-side worker delivers to PostHog later, retryably, independent of the
-- browser. Supabase stays authoritative; a downstream (PostHog/Sentry) failure NEVER rolls back or
-- hides the saved session/report.
--
-- Idempotency: stable insert_id `<event_type>:<record_id>` + a UNIQUE (event_type, record_id) claim,
-- so retries and concurrent workers can never double-deliver.

CREATE TABLE IF NOT EXISTS public.telemetry_outbox (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type text NOT NULL,
  record_id uuid NOT NULL,
  insert_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  last_failure_category text,
  event_timestamp timestamptz NOT NULL,
  -- Server-assigned provenance (never client-supplied).
  data_origin text NOT NULL DEFAULT 'production_user',
  cohort_id text,
  test_run_id text,
  test_suite text,
  release_sha text,
  environment text NOT NULL DEFAULT 'production',
  backfilled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telemetry_outbox_event_type_safe CHECK (event_type IN ('session_saved', 'report_issue_submitted')),
  CONSTRAINT telemetry_outbox_status_safe CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  CONSTRAINT telemetry_outbox_failure_safe CHECK (
    last_failure_category IS NULL OR last_failure_category IN ('config_missing', 'ingest_rejected', 'transport_error', 'unknown')
  ),
  -- Durable dedupe: exactly one logical event per (type, record).
  CONSTRAINT telemetry_outbox_dedupe UNIQUE (event_type, record_id)
);

ALTER TABLE public.telemetry_outbox ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: service-role (worker) only. No prose/transcript/PII columns exist here.

CREATE INDEX IF NOT EXISTS telemetry_outbox_due_idx
  ON public.telemetry_outbox (next_retry_at)
  WHERE status IN ('pending', 'failed');

-- Enqueue helper — resolves server-assigned provenance and inserts the outbox row idempotently.
-- Wrapped by callers so a failure NEVER rolls back the primary persistence.
CREATE OR REPLACE FUNCTION public.enqueue_telemetry_event(
  p_event_type text,
  p_record_id uuid,
  p_user_id uuid,
  p_event_timestamp timestamptz,
  p_release_sha text
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
    data_origin, cohort_id, test_run_id, test_suite, release_sha
  ) VALUES (
    p_event_type, p_record_id, p_event_type || ':' || p_record_id::text, p_event_timestamp,
    COALESCE(v_prov.data_origin, 'production_user'), v_prov.cohort_id, v_prov.test_run_id, v_prov.test_suite, p_release_sha
  )
  ON CONFLICT (event_type, record_id) DO NOTHING;
END;
$$;

-- Trigger: a report enqueues report_issue_submitted on insert. EXCEPTION guard = never block the
-- report insert if enqueue fails (reconciliation backfills any gap).
CREATE OR REPLACE FUNCTION public.trg_enqueue_report_telemetry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.enqueue_telemetry_event(
      'report_issue_submitted', NEW.id, NEW.user_id, NEW.created_at,
      NULLIF(NEW.metadata->'appRuntimeConfig'->>'release', '')
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- persistence must survive an outbox failure
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_report_telemetry_outbox ON public.user_issue_reports;
CREATE TRIGGER trg_report_telemetry_outbox
  AFTER INSERT ON public.user_issue_reports
  FOR EACH ROW EXECUTE FUNCTION public.trg_enqueue_report_telemetry();

-- Trigger: a session enqueues session_saved when it reaches 'completed'. Idempotent via the unique
-- claim, so repeated updates never duplicate.
CREATE OR REPLACE FUNCTION public.trg_enqueue_session_telemetry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    BEGIN
      PERFORM public.enqueue_telemetry_event('session_saved', NEW.id, NEW.user_id, NEW.created_at, NULL);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_session_telemetry_outbox ON public.sessions;
CREATE TRIGGER trg_session_telemetry_outbox
  AFTER INSERT OR UPDATE OF status ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.trg_enqueue_session_telemetry();

-- Worker claim: atomically lease up to p_limit due rows (concurrency-safe via FOR UPDATE SKIP LOCKED),
-- mark them 'sending', and return them. Two workers can never claim the same row.
CREATE OR REPLACE FUNCTION public.claim_telemetry_batch(p_limit integer DEFAULT 50)
RETURNS SETOF public.telemetry_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT o.id
    FROM public.telemetry_outbox o
    WHERE o.status IN ('pending', 'failed')
      AND o.next_retry_at <= now()
    ORDER BY o.next_retry_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.telemetry_outbox t
    SET status = 'sending', attempt_count = t.attempt_count + 1
    FROM due
    WHERE t.id = due.id
    RETURNING t.*;
END;
$$;

-- Worker mark: terminal 'sent', or 'failed' with bounded exponential backoff + fixed failure category.
CREATE OR REPLACE FUNCTION public.mark_telemetry_result(
  p_id uuid,
  p_status text,
  p_failure_category text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status = 'sent' THEN
    UPDATE public.telemetry_outbox SET status = 'sent', last_failure_category = NULL WHERE id = p_id;
  ELSE
    UPDATE public.telemetry_outbox
      SET status = 'failed',
          last_failure_category = p_failure_category,
          -- bounded backoff: 2^attempt minutes, capped at 60 minutes
          next_retry_at = now() + (LEAST(power(2, LEAST(attempt_count, 6))::int, 60) || ' minutes')::interval
      WHERE id = p_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_telemetry_event(text, uuid, uuid, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_telemetry_batch(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_telemetry_result(uuid, text, text) FROM PUBLIC, anon, authenticated;
