-- #1306 — METRICS/SIGNALS-ONLY persistence enforcement (fail-closed).
--
-- LOCKED product decision: SpeakSharp persists metrics/signals only. No transcript, transcript excerpt,
-- transcript segment, raw STT output, quoted speech, or free-form coaching prose may cross the persistence
-- interface. This migration makes that a DATABASE INVARIANT (not just a writer convention) so content cannot
-- be persisted from any writer, ever.
--
-- It (1) adds the strict, enum-constrained structured recommendation column that REPLACES `ai_suggestions`
-- prose, and (2) installs fail-closed BEFORE INSERT/UPDATE triggers that RAISE on any content-bearing write to
-- `sessions` (transcript / ai_suggestions / ground_truth / customer accuracy) and to
-- `user_issue_reports.transcript_excerpt`. Column DROP + the newest-two retention retirement land in a later
-- stage of this PR once no reader/writer touches those columns; this migration is the enforcement backstop.
--
-- No data is copied or archived (PO: no current customers, nothing to preserve). Content-free.
--
-- PAIRED SOURCE ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_sessions_metrics_only ON public.sessions;
--   DROP TRIGGER IF EXISTS trg_issue_reports_metrics_only ON public.user_issue_reports;
--   DROP FUNCTION IF EXISTS public.reject_session_content_1306();
--   DROP FUNCTION IF EXISTS public.reject_issue_report_content_1306();
--   ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_recommendation_signals_shape;
--   ALTER TABLE public.sessions DROP COLUMN IF EXISTS recommendation_signals;

-- 1) The ONE structured next action. Strictly enum/numeric; the CHECK rejects unknown keys and free-form
--    strings, mirroring the frontend `validateRecommendationSignal` contract, so prose cannot be stored here.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS recommendation_signals JSONB;

ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_recommendation_signals_shape;
ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_recommendation_signals_shape CHECK (
    recommendation_signals IS NULL OR (
      jsonb_typeof(recommendation_signals) = 'object'
      -- exactly these six keys — `?&` requires all present; subtracting them must leave an empty object,
      -- which rejects ANY extra/unknown key (e.g. a smuggled `what_to_try_next` prose field).
      AND recommendation_signals ?& array['reasonCode','actionCode','metric','value','comparator','templateVersion']
      AND (recommendation_signals - array['reasonCode','actionCode','metric','value','comparator','templateVersion']) = '{}'::jsonb
      AND recommendation_signals->>'reasonCode' = ANY (ARRAY['HIGH_FILLER_RATE','PACE_TOO_FAST','PACE_TOO_SLOW','EXTENDED_PAUSES','CLARITY_BELOW_BASELINE','ESTABLISH_BASELINE','ON_TRACK'])
      AND recommendation_signals->>'actionCode' = ANY (ARRAY['REDUCE_FILLERS','SLOW_DOWN','SPEED_UP','TIGHTEN_PAUSES','IMPROVE_CLARITY','RECORD_BASELINE','MAINTAIN'])
      AND recommendation_signals->>'metric' = ANY (ARRAY['filler_rate','wpm','extended_pauses','clarity_score','none'])
      AND recommendation_signals->>'comparator' = ANY (ARRAY['above_baseline','below_baseline','above_target','below_target','within_target','no_baseline'])
      AND recommendation_signals->>'templateVersion' = 'rec_v1'
      AND jsonb_typeof(recommendation_signals->'value') = 'number'
    )
  );

-- 2) Fail-closed content rejection on `sessions`. A non-empty transcript / any ai_suggestions / any ground_truth
--    / any customer accuracy on write RAISES — content cannot be persisted regardless of the caller.
CREATE OR REPLACE FUNCTION public.reject_session_content_1306()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.transcript IS NOT NULL AND btrim(NEW.transcript) <> '' THEN
    RAISE EXCEPTION '#1306 metrics-only: transcript text must not be persisted' USING ERRCODE = '22000';
  END IF;
  IF NEW.ai_suggestions IS NOT NULL THEN
    RAISE EXCEPTION '#1306 metrics-only: free-form ai_suggestions prose must not be persisted (use recommendation_signals)' USING ERRCODE = '22000';
  END IF;
  IF NEW.ground_truth IS NOT NULL THEN
    RAISE EXCEPTION '#1306 metrics-only: ground_truth is benchmark-only and must not be persisted on customer sessions' USING ERRCODE = '22000';
  END IF;
  IF NEW.accuracy IS NOT NULL THEN
    RAISE EXCEPTION '#1306 metrics-only: customer-session accuracy has no ground truth and must not be persisted' USING ERRCODE = '22000';
  END IF;
  -- A COMPLETED session carries exactly ONE structured next action; incomplete/failed sessions may be null.
  -- (Validity of the object is enforced by the sessions_recommendation_signals_shape CHECK.)
  IF NEW.status = 'completed' AND NEW.recommendation_signals IS NULL THEN
    RAISE EXCEPTION '#1306: a completed session requires exactly one structured recommendation_signals next action' USING ERRCODE = '23514';
  END IF;
  NEW.transcript_state := 'not_captured';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sessions_metrics_only ON public.sessions;
CREATE TRIGGER trg_sessions_metrics_only
  BEFORE INSERT OR UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.reject_session_content_1306();

-- 3) Fail-closed content rejection on issue reports: no transcript excerpt may be stored.
CREATE OR REPLACE FUNCTION public.reject_issue_report_content_1306()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.transcript_excerpt IS NOT NULL AND btrim(NEW.transcript_excerpt) <> '' THEN
    RAISE EXCEPTION '#1306 metrics-only: issue-report transcript_excerpt must not be persisted' USING ERRCODE = '22000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_issue_reports_metrics_only ON public.user_issue_reports;
CREATE TRIGGER trg_issue_reports_metrics_only
  BEFORE INSERT OR UPDATE ON public.user_issue_reports
  FOR EACH ROW EXECUTE FUNCTION public.reject_issue_report_content_1306();
