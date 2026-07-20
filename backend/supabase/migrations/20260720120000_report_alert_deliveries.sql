-- P0.4 — durable owner-alert delivery state for issue reports.
--
-- The full report lives in public.user_issue_reports. This table holds ONLY the sanitized alert
-- delivery state (never report prose, transcript, audio, or user identity). Its PRIMARY KEY on
-- report_id is the durable, atomic dedupe claim: exactly one owner alert is ever sent per report,
-- even under concurrent or retried alert attempts. A failed attempt stays observable and is safely
-- retryable; a sent alert is never resent.
--
-- RLS is enabled with NO policies, so the table is reachable ONLY by the service role (the trusted
-- backend alert function). Authenticated users and anon have no access.

CREATE TABLE IF NOT EXISTS public.report_alert_deliveries (
  report_id uuid PRIMARY KEY REFERENCES public.user_issue_reports(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  failure_category text,
  attempt_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_alert_deliveries_status_safe CHECK (status IN ('pending', 'sent', 'failed')),
  -- Fixed failure taxonomy only — never a raw exception message.
  CONSTRAINT report_alert_deliveries_failure_category_safe CHECK (
    failure_category IS NULL OR failure_category IN (
      'sentry_config_missing',
      'sentry_ingest_rejected',
      'transport_error',
      'unknown'
    )
  )
);

ALTER TABLE public.report_alert_deliveries ENABLE ROW LEVEL SECURITY;

-- Intentionally NO policies: only the service role (which bypasses RLS) may read/write delivery
-- state. This is the trusted-backend-only alert surface.

CREATE INDEX IF NOT EXISTS report_alert_deliveries_status_idx
  ON public.report_alert_deliveries (status, last_attempt_at DESC);

-- Atomic dedupe claim: returns true only for the caller that wins the right to send the owner alert
-- for p_report_id. First attempt inserts a 'pending' row; a previously 'failed' delivery may be
-- re-claimed for a safe retry; a 'sent' or in-flight 'pending' delivery is never re-claimed (returns
-- false) so the alert is never resent. The FK on report_id means a claim for a non-existent report
-- raises, so no orphan delivery state is created.
CREATE OR REPLACE FUNCTION public.claim_report_alert(p_report_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed boolean;
BEGIN
  INSERT INTO public.report_alert_deliveries (report_id, status, attempt_count, last_attempt_at)
  VALUES (p_report_id, 'pending', 1, now())
  ON CONFLICT (report_id) DO UPDATE
    SET status = 'pending',
        attempt_count = public.report_alert_deliveries.attempt_count + 1,
        last_attempt_at = now()
    WHERE public.report_alert_deliveries.status = 'failed'
  RETURNING true INTO v_claimed;
  RETURN COALESCE(v_claimed, false);
END;
$$;

-- Record the terminal delivery state (sanitized). Only ever a fixed status + failure category.
CREATE OR REPLACE FUNCTION public.mark_report_alert(
  p_report_id uuid,
  p_status text,
  p_failure_category text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.report_alert_deliveries
    SET status = p_status,
        failure_category = p_failure_category,
        last_attempt_at = now()
    WHERE report_id = p_report_id;
END;
$$;

-- These claim/mark helpers are service-role-only (the trusted backend alert function). Users/anon
-- must never call them directly.
REVOKE ALL ON FUNCTION public.claim_report_alert(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_report_alert(uuid, text, text) FROM PUBLIC, anon, authenticated;
