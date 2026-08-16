-- #1306 STAGE B — POST-DEPLOY ENFORCEMENT + FINAL SCHEMA. Apply ONLY AFTER the metrics-only frontend (uses the
-- new complete_session exclusively, reads no content columns) is deployed. Applying B before that would break
-- the running app.
--
-- Authorized sequence: [Stage A] -> deploy metrics-only frontend -> (optional separately-authorized SCRUB that
-- HARD-DELETES legacy session/issue-report rows — counts only, never reads/backfills content) -> [B here].
--
-- Safety: NO `DROP ... CASCADE`. Known dependencies are removed EXPLICITLY, then columns are dropped without
-- CASCADE, so any UNEXPECTED dependency (view/policy/generated column) fails the migration CLOSED instead of
-- being silently removed.
--
-- No PAIRED ROLLBACK for the column drops — this is the terminal metrics-only schema.

-- 0) CONTENT-FREE PREFLIGHT: after B, a completed session must carry a recommendation. If any EXISTING
--    completed row (e.g. a legacy canary/test session) lacks one, fail closed and require the authorized scrub
--    first. Counts only — never reads transcript/content.
DO $$
DECLARE v_bad bigint;
BEGIN
    SELECT count(*) INTO v_bad FROM public.sessions WHERE status = 'completed' AND recommendation_signals IS NULL;
    IF v_bad > 0 THEN
        RAISE EXCEPTION '#1306 Stage B preflight: % completed session row(s) lack recommendation_signals — run the authorized content-free scrub (hard-delete legacy rows) before Stage B', v_bad
            USING ERRCODE = '23514';
    END IF;
END $$;

-- 1) Remove the legacy transcript-accepting RPCs (the transcript-free overload from Stage A remains).
DROP FUNCTION IF EXISTS public.complete_session(uuid, text, text, integer, text);
DROP FUNCTION IF EXISTS public.save_session(jsonb);

-- 2) Retire the transcript-retention machinery (its functions reference the columns dropped below).
DROP FUNCTION IF EXISTS public.transcript_retention_preflight(text, uuid, text);
DROP FUNCTION IF EXISTS public.converge_transcript_retention(uuid);
DROP FUNCTION IF EXISTS public.expire_transcripts_newest_two(uuid, integer);
DROP FUNCTION IF EXISTS public.transcript_sessions_to_expire(uuid);
DROP FUNCTION IF EXISTS public.transcript_retention_invariant_violations(uuid);
DROP FUNCTION IF EXISTS public.transcript_retention_policy_version();

-- 3) Remove the #1131 transcript_state derivation + its CHECK constraints (hard dependencies on `transcript`).
DROP TRIGGER IF EXISTS trg_sessions_set_transcript_state ON public.sessions;
DROP FUNCTION IF EXISTS public.sessions_set_transcript_state();
ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_transcript_state_check;
ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_expired_transcript_null_check;

-- 4) FINAL SCHEMA: drop the content-bearing columns WITHOUT cascade. Any remaining unexpected dependency
--    raises here (fail-closed) rather than being silently dropped.
ALTER TABLE public.sessions DROP COLUMN IF EXISTS transcript;
ALTER TABLE public.sessions DROP COLUMN IF EXISTS ai_suggestions;
ALTER TABLE public.sessions DROP COLUMN IF EXISTS ground_truth;
ALTER TABLE public.sessions DROP COLUMN IF EXISTS accuracy;
ALTER TABLE public.user_issue_reports DROP COLUMN IF EXISTS transcript_excerpt;

-- 5) A COMPLETED session must carry exactly one structured next action; incomplete/failed may be null.
--    Backstop enforcement for EVERY writer (validity of the object is enforced by the Stage-A shape CHECK).
CREATE OR REPLACE FUNCTION public.require_recommendation_on_complete_1306()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'completed' AND NEW.recommendation_signals IS NULL THEN
    RAISE EXCEPTION '#1306: a completed session requires exactly one structured recommendation_signals next action'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sessions_require_recommendation ON public.sessions;
CREATE TRIGGER trg_sessions_require_recommendation
  BEFORE INSERT OR UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.require_recommendation_on_complete_1306();
