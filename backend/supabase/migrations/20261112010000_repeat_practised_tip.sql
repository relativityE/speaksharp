-- Outcome 4, step 2 (decision D2): the coaching tip a repeat practised moves with the repeat.
--
-- WHY THE SERVER SNAPSHOTS IT AT ACCEPTANCE
-- The tip is the original session's `sessions.ai_suggestions.what_to_try_next`. Saving the repeat runs newest-one
-- transcript retention inside the save (`converge_transcript_retention`), and `trg_sessions_purge_derived_on_expire`
-- nulls the original's `ai_suggestions` in that same save. The attempt is advanced only AFTER the save, so the text is
-- gone by then. The one moment the tip still exists and is known to be the one practised is when Practice again is
-- pressed, i.e. when `record_recommendation_attempt()` inserts the attempt. The client stores only a hash of it.
--
-- WHAT THIS ADDS (additive; no existing function body is replaced)
--   * `progress_recommendation_attempts.practised_tip` (nullable text). Clients keep SELECT only, so they can read it
--     on their own attempts and never write it.
--   * BEFORE INSERT: the server fills it from the source session's contract-valid review (the same rule as the client's
--     `readSavedReview`: exactly version/what_to_try_next/what_worked, a known version, both halves non-blank). Any
--     caller-supplied value is discarded. No valid review, or an already-expired original, leaves it NULL.
--   * BEFORE UPDATE: it can never be set or changed after insert, only cleared. It is cleared when the attempt is
--     abandoned, when it resolves without a practice session, and when its practice session is deleted (the FK's
--     ON DELETE SET NULL arrives here as an update).
--   * AFTER a session's transcript expires: clear it on attempts practised in that session (the tip follows the
--     repeat's own retention), and on still-pending attempts whose original expired before this newer session did
--     (a pending attempt keeps it for at most one save past its original's expiry, which is the save that resolves it).
--   * Account deletion already removes attempts (user_id ON DELETE CASCADE); deleting the original cascades through its
--     recommendation.
--
-- The tip is shown as practised, never measured or scored (decision D1). Content-bearing: it obeys the same
-- newest-one rule as the transcript it was derived from, attached to the repeat instead of the original.
--
-- NOT APPLIED TO PRODUCTION BY THIS MIGRATION. Requires separate Product Owner authorization.
-- ROLLBACK: drop the three triggers and their functions, then `ALTER TABLE ... DROP COLUMN practised_tip`.

ALTER TABLE public.progress_recommendation_attempts
    ADD COLUMN IF NOT EXISTS practised_tip text;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prec_att_practised_tip_shape') THEN
        ALTER TABLE public.progress_recommendation_attempts
            ADD CONSTRAINT prec_att_practised_tip_shape
            CHECK (practised_tip IS NULL OR (char_length(practised_tip) BETWEEN 1 AND 4000 AND btrim(practised_tip) = practised_tip));
    END IF;
END $$;

COMMENT ON COLUMN public.progress_recommendation_attempts.practised_tip IS
    'Outcome 4 D2: the original session''s coaching tip as it stood when Practice again was pressed. Server-filled at '
    'insert only, never measured. Cleared with the repeat''s transcript retention, on abandonment, and when the repeat '
    'is deleted.';

-- The tip in a stored review, under the same contract as the client's readSavedReview(). NULL when not contract-valid.
CREATE OR REPLACE FUNCTION public._prec_att_review_tip(p_review jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
AS $$
DECLARE
    v_review jsonb := p_review;
    v_tip text;
    v_worked text;
BEGIN
    IF v_review IS NULL THEN RETURN NULL; END IF;
    -- A review stored as a JSON string is parsed, as the client does.
    IF jsonb_typeof(v_review) = 'string' THEN
        BEGIN
            v_review := (v_review #>> '{}')::jsonb;
        EXCEPTION WHEN others THEN
            RETURN NULL;
        END;
    END IF;
    IF jsonb_typeof(v_review) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_review) AS k)
       IS DISTINCT FROM ARRAY['version', 'what_to_try_next', 'what_worked'] THEN
        RETURN NULL;
    END IF;
    IF jsonb_typeof(v_review -> 'version') IS DISTINCT FROM 'string'
       OR (v_review ->> 'version') NOT IN ('gemini_coaching_v1', 'gemini_coaching_focus_v1') THEN
        RETURN NULL;
    END IF;
    IF jsonb_typeof(v_review -> 'what_to_try_next') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_review -> 'what_worked') IS DISTINCT FROM 'string' THEN
        RETURN NULL;
    END IF;
    v_tip := btrim(v_review ->> 'what_to_try_next');
    v_worked := btrim(v_review ->> 'what_worked');
    IF v_tip = '' OR v_worked = '' OR char_length(v_tip) > 4000 THEN RETURN NULL; END IF;
    RETURN v_tip;
END;
$$;

-- BEFORE INSERT: snapshot the original's tip; never trust a supplied value.
CREATE OR REPLACE FUNCTION public._prec_att_snapshot_tip()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    SELECT public._prec_att_review_tip(s.ai_suggestions)
      INTO NEW.practised_tip
      FROM public.progress_recommendations r
      JOIN public.sessions s ON s.id = r.source_session_id
     WHERE r.id = NEW.recommendation_id
       AND r.user_id = NEW.user_id
       AND s.user_id = NEW.user_id
       AND s.transcript_state IS DISTINCT FROM 'expired';
    IF NOT FOUND THEN NEW.practised_tip := NULL; END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prec_att_snapshot_tip ON public.progress_recommendation_attempts;
CREATE TRIGGER trg_prec_att_snapshot_tip
    BEFORE INSERT ON public.progress_recommendation_attempts
    FOR EACH ROW EXECUTE FUNCTION public._prec_att_snapshot_tip();

-- BEFORE UPDATE: the tip is insert-only; afterwards it may only be cleared.
CREATE OR REPLACE FUNCTION public._prec_att_guard_tip()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.practised_tip IS NOT NULL AND NEW.practised_tip IS DISTINCT FROM OLD.practised_tip THEN
        RAISE EXCEPTION 'practised_tip is set only when the attempt is recorded' USING ERRCODE = '42501';
    END IF;
    IF NEW.lifecycle = 'abandoned'
       OR (NEW.lifecycle IN ('completed', 'not_comparable') AND NEW.practice_session_id IS NULL)
       OR (OLD.practice_session_id IS NOT NULL AND NEW.practice_session_id IS NULL) THEN
        NEW.practised_tip := NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prec_att_guard_tip ON public.progress_recommendation_attempts;
CREATE TRIGGER trg_prec_att_guard_tip
    BEFORE UPDATE ON public.progress_recommendation_attempts
    FOR EACH ROW EXECUTE FUNCTION public._prec_att_guard_tip();

-- AFTER a session's transcript expires: the tip follows the repeat's retention.
CREATE OR REPLACE FUNCTION public._prec_att_purge_tip_on_expire()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.progress_recommendation_attempts a
       SET practised_tip = NULL
     WHERE a.user_id = NEW.user_id
       AND a.practised_tip IS NOT NULL
       AND (
            a.practice_session_id = NEW.id
            OR (a.lifecycle = 'pending' AND EXISTS (
                SELECT 1
                  FROM public.progress_recommendations r
                  JOIN public.sessions src ON src.id = r.source_session_id
                 WHERE r.id = a.recommendation_id
                   AND src.id <> NEW.id
                   AND src.transcript_state = 'expired'
                   AND (src.created_at, src.id) < (NEW.created_at, NEW.id)))
       );
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sessions_purge_practised_tip_on_expire ON public.sessions;
CREATE TRIGGER trg_sessions_purge_practised_tip_on_expire
    AFTER UPDATE OF transcript_state ON public.sessions
    FOR EACH ROW
    WHEN (NEW.transcript_state = 'expired' AND OLD.transcript_state IS DISTINCT FROM 'expired')
    EXECUTE FUNCTION public._prec_att_purge_tip_on_expire();

REVOKE ALL ON FUNCTION public._prec_att_review_tip(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._prec_att_snapshot_tip() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._prec_att_guard_tip() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._prec_att_purge_tip_on_expire() FROM PUBLIC, anon, authenticated;
