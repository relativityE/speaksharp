-- #1306 STAGE B — POST-DEPLOY ENFORCEMENT + FINAL SCHEMA. Apply ONLY AFTER the metrics-only frontend (which
-- uses the new complete_session exclusively and reads no content columns) is deployed. Applying B before that
-- frontend is live would break the running app.
--
-- It (1) removes the old transcript-accepting `complete_session(uuid,text,text,int,text)`; (2) DROPs the
-- content-bearing columns from `sessions` (transcript, ai_suggestions, ground_truth, accuracy) and
-- `user_issue_reports.transcript_excerpt` — so content cannot be persisted because the fields no longer exist;
-- (3) requires a structured recommendation for any completed session (backstop for every writer); and
-- (4) retires the newest-two transcript-retention machinery (nothing reads/writes transcripts anymore).
--
-- No data is copied/archived (PO: no current customers). Canary/test rows carry no content to preserve.
--
-- PAIRED SOURCE ROLLBACK is intentionally NOT provided for the column drops (this is the terminal metrics-only
-- schema); re-adding content columns would reintroduce the privacy risk and is out of contract.

-- 1) Remove the legacy transcript-accepting RPC. The transcript-free overload from Stage A remains.
DROP FUNCTION IF EXISTS public.complete_session(uuid, text, text, integer, text);

-- 2) Retire the transcript-retention machinery FIRST (its functions reference the columns dropped below).
DROP FUNCTION IF EXISTS public.transcript_retention_preflight(text, uuid, text);
DROP FUNCTION IF EXISTS public.converge_transcript_retention(uuid);
DROP FUNCTION IF EXISTS public.expire_transcripts_newest_two(uuid, integer);
DROP FUNCTION IF EXISTS public.transcript_sessions_to_expire(uuid);
DROP FUNCTION IF EXISTS public.transcript_retention_invariant_violations(uuid);
DROP FUNCTION IF EXISTS public.transcript_retention_policy_version();

-- 3) FINAL SCHEMA: drop the content-bearing columns. CASCADE removes any dependent constraint/trigger/index
--    (e.g. the #1131 transcript_state<->transcript invariant), since the columns cease to exist entirely.
ALTER TABLE public.sessions DROP COLUMN IF EXISTS transcript CASCADE;
ALTER TABLE public.sessions DROP COLUMN IF EXISTS ai_suggestions CASCADE;
ALTER TABLE public.sessions DROP COLUMN IF EXISTS ground_truth CASCADE;
ALTER TABLE public.sessions DROP COLUMN IF EXISTS accuracy CASCADE;
ALTER TABLE public.user_issue_reports DROP COLUMN IF EXISTS transcript_excerpt CASCADE;

-- 4) A COMPLETED session must carry exactly one structured next action; incomplete/failed may be null.
--    Backstop enforcement for EVERY writer (validity of the object is enforced by the shape CHECK from Stage A).
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
