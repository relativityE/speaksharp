-- Outcome 4, step 2 (decision D2): the coaching tip chosen for a repeat is kept with that repeat, under its own
-- explicit retention rule. Revision 3, after Sam's reviews of the first design and of revision 2 (2026-11-12).
--
-- WHY A COPY, AND WHY IT IS TAKEN WHEN PRACTICE AGAIN IS PRESSED
-- The tip is the original session's `sessions.ai_suggestions.what_to_try_next`. Saving the repeat runs newest-one
-- transcript retention inside `complete_session_v2`, which expires the original and (via
-- `trg_sessions_purge_derived_on_expire`) nulls its `ai_suggestions` in that same save. The client binds the repeat
-- with `advance_recommendation_attempt` only AFTER the save, so by then the text is gone. The one moment the tip
-- still exists and is known to be the one chosen is when `record_recommendation_attempt()` inserts the attempt.
--
-- THE THREE REVIEW BLOCKERS, AND HOW THIS REVISION MEETS THEM
--   1. "The repeat save expires the original before advance binds the repeat." The repeat is now bound BY THE
--      SERVER at the moment the repeat session becomes `completed`. In `complete_session_v2` that is the metrics
--      write (step 1), which runs before the transcript write and retention (step 2). So the binding exists before
--      the original expires, and the client's later advance can only confirm it, never choose it.
--   2. "The purge trigger requires ai_suggestions IS NOT NULL; deleting the repeat sets practice_session_id NULL."
--      Cleanup here never reads `ai_suggestions` or transcripts: it keys on a session becoming completed, on the
--      bound session expiring, and on the bound or practice session being deleted (both FKs are SET NULL, which
--      arrives at the BEFORE UPDATE guard as an update and clears the tip).
--   3. "Keeping the tip beyond its source's expiry changes content retention." The rule is explicit (below) and
--      stated in the product copy beside the tip.
--
-- REVISION 3 (Sam's return of revision 2 at 1186c368)
--   a. An unbound copy now goes when its original expires. A copy already bound to the repeat (which happens in the
--      repeat's save, before that save expires the original) is kept.
--   b. A copy is taken only from the owner's NEWEST saved session, and only while it is unexpired. Pressing Practice
--      again on an older session's still-available review copies nothing.
--   c. Acceptance, saves and expiry for one owner are serialised by one per-owner advisory transaction lock, so a
--      new attempt row cannot slip past a concurrent save or expiry (row locks cannot cover a row not yet inserted).
--      The advisory lock is used, not the `user_profiles` row, because the save path takes that row with NOWAIT and
--      a held row would make a concurrent save fail.
--
-- RETENTION RULE (proposed; content-bearing, never measured)
--   The copy exists only while it is attached to the newest saved session that can still be its repeat:
--     * It is taken only when Practice again is pressed on the owner's newest saved session, while that session is
--       unexpired. Before any repeat is saved, it lives with that original and goes if the original expires.
--     * The first session completed after Practice again was pressed (newer than the original) is bound as its
--       repeat, once, by the server. The copy then lives with that repeat.
--     * It is deleted when ANY newer session is saved, when the repeat expires, when the repeat is deleted, when
--       the attempt is abandoned, when the attempt is resolved to a session other than the bound repeat, and when
--       the account is deleted (user_id cascade). Deleting the original deletes its recommendation and attempt.
--     * A newer session saved that cannot be the repeat (it started before Practice again was pressed) deletes it.
--   So at most one saved session's worth of chosen-tip text exists per attempt, and only while that session is the
--   newest one, the same lifetime newest-one retention gives that session's transcript.
--
-- SERVER-SOURCED, IMMUTABLE, OWNER-ONLY
--   * `practised_tip` is filled only by the BEFORE INSERT trigger from the source session's contract-valid review
--     (the client's `readSavedReview` rule). A supplied value is discarded. Afterwards it can only be cleared.
--   * `tip_session_id` is set once, only by the completion trigger, only to a validated session, and never moved.
--   * Clients keep SELECT only on this table (existing RLS: own rows). No client-callable function is added.
--   * Concurrency: acceptance, completion and expiry each take the owner's advisory lock first, and the completion
--     trigger then locks the owner's tip-bearing attempts, so a concurrent accept, save, expiry, advance or retry is
--     decided on the latest committed rows, never on a stale snapshot.
--
-- NOT APPLIED TO ANY DATABASE BY THIS CHANGE. Requires separate Product Owner authorization.
-- ROLLBACK: drop the four triggers and their functions (and `_prec_att_lock_owner`), then drop the columns
-- `tip_session_id` and `practised_tip`.

ALTER TABLE public.progress_recommendation_attempts
    ADD COLUMN IF NOT EXISTS practised_tip text,
    ADD COLUMN IF NOT EXISTS tip_session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prec_att_practised_tip_shape') THEN
        ALTER TABLE public.progress_recommendation_attempts
            ADD CONSTRAINT prec_att_practised_tip_shape
            CHECK (practised_tip IS NULL OR (char_length(practised_tip) BETWEEN 1 AND 4000 AND btrim(practised_tip) = practised_tip));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_prec_att_tip_session ON public.progress_recommendation_attempts (tip_session_id)
    WHERE tip_session_id IS NOT NULL;

COMMENT ON COLUMN public.progress_recommendation_attempts.practised_tip IS
    'Outcome 4 D2: the original session''s coaching tip as it stood when Practice again was pressed. Server-filled '
    'at insert only, never measured. Kept only while its original or its bound repeat is the newest saved session.';
COMMENT ON COLUMN public.progress_recommendation_attempts.tip_session_id IS
    'Outcome 4 D2: the repeat the tip is bound to, set once by the server when that session completes.';

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

-- One lock per owner for every decision about a copy: acceptance, completion and expiry. Held to commit.
CREATE OR REPLACE FUNCTION public._prec_att_lock_owner(p_user uuid)
RETURNS void
LANGUAGE sql VOLATILE SET search_path = public, pg_temp
AS $$
    SELECT pg_advisory_xact_lock(hashtextextended('prec_att_tip:' || p_user::text, 0));
$$;

-- BEFORE INSERT: snapshot the original's tip, only while the original is the owner's newest saved session and
-- unexpired; never trust a supplied value or binding.
CREATE OR REPLACE FUNCTION public._prec_att_snapshot_tip()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.tip_session_id := NULL;
    NEW.practised_tip := NULL;
    -- Wait for any concurrent save or expiry for this owner; the next statement then sees it committed.
    PERFORM public._prec_att_lock_owner(NEW.user_id);
    SELECT public._prec_att_review_tip(s.ai_suggestions)
      INTO NEW.practised_tip
      FROM public.progress_recommendations r
      JOIN public.sessions s ON s.id = r.source_session_id
     WHERE r.id = NEW.recommendation_id
       AND r.user_id = NEW.user_id
       AND s.user_id = NEW.user_id
       AND s.status = 'completed'
       AND s.transcript_state IS DISTINCT FROM 'expired'
       AND NOT EXISTS (
           SELECT 1 FROM public.sessions n
            WHERE n.user_id = NEW.user_id AND n.status = 'completed' AND n.id <> s.id
              AND (n.created_at, n.id) > (s.created_at, s.id));
    IF NOT FOUND THEN NEW.practised_tip := NULL; END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prec_att_snapshot_tip ON public.progress_recommendation_attempts;
CREATE TRIGGER trg_prec_att_snapshot_tip
    BEFORE INSERT ON public.progress_recommendation_attempts
    FOR EACH ROW EXECUTE FUNCTION public._prec_att_snapshot_tip();

-- Whether p_session can be the repeat for this attempt: the owner's completed session, other than and newer than
-- the original, started no earlier than Practice again was pressed.
CREATE OR REPLACE FUNCTION public._prec_att_can_hold_tip(p_attempt public.progress_recommendation_attempts, p_session uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.sessions s
          JOIN public.progress_recommendations r ON r.id = p_attempt.recommendation_id AND r.user_id = p_attempt.user_id
          JOIN public.sessions src ON src.id = r.source_session_id
         WHERE s.id = p_session
           AND s.user_id = p_attempt.user_id
           AND s.status = 'completed'
           AND s.id <> src.id
           AND (src.created_at, src.id) < (s.created_at, s.id)
           AND s.created_at >= p_attempt.accepted_at);
$$;

-- BEFORE UPDATE: the tip is insert-only, the binding is set once to a valid repeat, and every way the tip can stop
-- belonging to its repeat clears it.
CREATE OR REPLACE FUNCTION public._prec_att_guard_tip()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.practised_tip IS NOT NULL AND NEW.practised_tip IS DISTINCT FROM OLD.practised_tip THEN
        RAISE EXCEPTION 'practised_tip is set only when the attempt is recorded' USING ERRCODE = '42501';
    END IF;
    IF NEW.tip_session_id IS DISTINCT FROM OLD.tip_session_id AND NEW.tip_session_id IS NOT NULL THEN
        IF OLD.tip_session_id IS NOT NULL THEN
            RAISE EXCEPTION 'the repeat a tip is bound to cannot change' USING ERRCODE = '42501';
        END IF;
        IF OLD.lifecycle <> 'pending' OR OLD.practised_tip IS NULL
           OR NOT public._prec_att_can_hold_tip(OLD, NEW.tip_session_id) THEN
            RAISE EXCEPTION 'this session cannot hold the tip for this attempt' USING ERRCODE = '42501';
        END IF;
    END IF;
    IF NEW.lifecycle = 'abandoned'
       OR (NEW.lifecycle IN ('completed', 'not_comparable')
           AND (NEW.practice_session_id IS NULL OR NEW.practice_session_id IS DISTINCT FROM NEW.tip_session_id))
       OR (OLD.practice_session_id IS NOT NULL AND NEW.practice_session_id IS NULL)
       OR (OLD.tip_session_id IS NOT NULL AND NEW.tip_session_id IS NULL) THEN
        NEW.practised_tip := NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prec_att_guard_tip ON public.progress_recommendation_attempts;
CREATE TRIGGER trg_prec_att_guard_tip
    BEFORE UPDATE ON public.progress_recommendation_attempts
    FOR EACH ROW EXECUTE FUNCTION public._prec_att_guard_tip();

-- AFTER a session becomes completed: first retire every copy that a newer save supersedes, then bind this session as
-- the repeat for pending attempts it can hold. Independent of coaching and transcript content.
CREATE OR REPLACE FUNCTION public._prec_att_on_session_completed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN RETURN NULL; END IF;

    -- Wait for any concurrent acceptance, save or expiry for this owner, then decide on the latest committed rows:
    -- including an attempt inserted by a concurrent Practice again, which no row lock could have covered.
    PERFORM public._prec_att_lock_owner(NEW.user_id);
    PERFORM 1 FROM public.progress_recommendation_attempts
      WHERE user_id = NEW.user_id AND practised_tip IS NOT NULL
      ORDER BY id FOR UPDATE;

    UPDATE public.progress_recommendation_attempts a
       SET practised_tip = NULL
     WHERE a.user_id = NEW.user_id
       AND a.practised_tip IS NOT NULL
       AND (
            -- held by an older repeat: this newer save supersedes it
            (a.tip_session_id IS NOT NULL AND a.tip_session_id <> NEW.id AND EXISTS (
                SELECT 1 FROM public.sessions h
                 WHERE h.id = a.tip_session_id AND (h.created_at, h.id) < (NEW.created_at, NEW.id)))
            -- not yet bound, this save supersedes the original, and this session cannot be its repeat
            OR (a.tip_session_id IS NULL
                AND NOT public._prec_att_can_hold_tip(a, NEW.id)
                AND EXISTS (
                    SELECT 1 FROM public.progress_recommendations r
                      JOIN public.sessions src ON src.id = r.source_session_id
                     WHERE r.id = a.recommendation_id AND src.id <> NEW.id
                       AND (src.created_at, src.id) < (NEW.created_at, NEW.id)))
       );

    UPDATE public.progress_recommendation_attempts a
       SET tip_session_id = NEW.id
     WHERE a.user_id = NEW.user_id
       AND a.practised_tip IS NOT NULL
       AND a.tip_session_id IS NULL
       AND a.lifecycle = 'pending'
       AND public._prec_att_can_hold_tip(a, NEW.id);
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sessions_prec_tip_on_completed ON public.sessions;
CREATE TRIGGER trg_sessions_prec_tip_on_completed
    AFTER INSERT OR UPDATE OF status ON public.sessions
    FOR EACH ROW
    WHEN (NEW.status = 'completed')
    EXECUTE FUNCTION public._prec_att_on_session_completed();

-- AFTER a session's transcript expires, with no condition on ai_suggestions:
--   * a copy bound to it, or resolved to it, goes (a newer completed save has normally cleared it already);
--   * a copy NOT YET BOUND whose original is this session goes. A copy already bound to a repeat stays: the repeat's
--     own save binds it before that save expires the original.
CREATE OR REPLACE FUNCTION public._prec_att_purge_tip_on_expire()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public._prec_att_lock_owner(NEW.user_id);
    UPDATE public.progress_recommendation_attempts a
       SET practised_tip = NULL
     WHERE a.user_id = NEW.user_id
       AND a.practised_tip IS NOT NULL
       AND (a.tip_session_id = NEW.id
            OR a.practice_session_id = NEW.id
            OR (a.tip_session_id IS NULL AND EXISTS (
                    SELECT 1 FROM public.progress_recommendations r
                     WHERE r.id = a.recommendation_id AND r.source_session_id = NEW.id)));
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
REVOKE ALL ON FUNCTION public._prec_att_lock_owner(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._prec_att_snapshot_tip() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._prec_att_can_hold_tip(public.progress_recommendation_attempts, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._prec_att_guard_tip() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._prec_att_on_session_completed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._prec_att_purge_tip_on_expire() FROM PUBLIC, anon, authenticated;
