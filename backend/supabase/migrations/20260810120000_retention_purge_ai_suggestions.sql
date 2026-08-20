-- #1046 / retention consistency — purge DERIVED content (ai_suggestions) WITH the transcript.
--
-- FINDING (2026-08-10 audit): the #1117 R1/R2 retention path nulls `sessions.transcript` and sets
-- `transcript_state = 'expired'` for every session outside a user's 2 most recent — but it left
-- `sessions.ai_suggestions` (the AI two-takeaways, which are DERIVED FROM and paraphrase the transcript)
-- intact. So content-bearing text survived the "we keep only your 2 most recent transcripts" promise.
--
-- DECISION (PO 2026-08-10): ai_suggestions ages out on the SAME 2-most-recent rule as the transcript —
-- it is content, so it goes when the transcript goes. This does NOT touch the content-free numeric metrics
-- (filler counts, wpm, clarity, pause rhythm) the analytics score-aggregation / progress history is built
-- from, so "progress over time" stays alive.
--
-- ai_suggestions is the ONLY content-bearing derived column on `sessions` beyond `transcript` (verified);
-- the trigger below trivially extends if another is ever added.

-- 1) Ongoing enforcement: whenever a session's transcript is expired, its derived content is nulled too.
--    Fires only when `transcript_state` is targeted AND lands on 'expired' AND ai_suggestions still lingers.
--    The inner UPDATE touches ai_suggestions only (NOT transcript_state), so `AFTER UPDATE OF transcript_state`
--    never re-fires — no recursion. SECURITY DEFINER so the null runs regardless of the caller's RLS.
CREATE OR REPLACE FUNCTION public.purge_derived_content_on_expire()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.sessions
       SET ai_suggestions = NULL
     WHERE id = NEW.id
       AND ai_suggestions IS NOT NULL;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sessions_purge_derived_on_expire ON public.sessions;
CREATE TRIGGER trg_sessions_purge_derived_on_expire
    AFTER UPDATE OF transcript_state ON public.sessions
    FOR EACH ROW
    WHEN (NEW.transcript_state = 'expired' AND NEW.ai_suggestions IS NOT NULL)
    EXECUTE FUNCTION public.purge_derived_content_on_expire();

-- 2) One-time backfill for sessions ALREADY expired before this fix (transcript already gone, but the
--    derived takeaways still linger — the ~1,738 rows from the 2026-08-10 purge).
UPDATE public.sessions
   SET ai_suggestions = NULL
 WHERE transcript_state = 'expired'
   AND ai_suggestions IS NOT NULL;

-- Post-apply readback (run in the SQL editor; expect leaked = 0):
--   SELECT count(*) AS leaked FROM public.sessions
--     WHERE transcript_state = 'expired' AND ai_suggestions IS NOT NULL;
