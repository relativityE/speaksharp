-- #1045 — durable recommendation identity + one-to-many attempts, written ONLY through guarded RPCs.
--
-- Implements `product_release/PROGRESS_AND_NEXT_ACTION.md` §8 and the follow-through funnel. Additive
-- only. `outcome` is a DIRECTIONAL OBSERVATION; nothing here licenses a causal claim.
--
-- ── WHY RPC-ONLY, AND WHAT "IMMUTABLE" REALLY REQUIRES ──
-- A recommendation must be tied to a PERSISTED, ELIGIBLE evaluation of a session the caller owns — a raw
-- client INSERT with `WITH CHECK (auth.uid() = user_id)` cannot verify that. And attempts must be
-- genuinely immutable in identity: a blanket `FOR UPDATE` policy would let a caller rewrite
-- `recommendation_id` or `accepted_at`. So:
--   * both tables grant SELECT only;
--   * `record_progress_recommendation()` creates the immutable recommendation, requiring an eligible
--     evaluation and DERIVING the source metric value from THAT persisted evaluation (never caller input,
--     so a later comparison is always against the number the evaluation actually recorded);
--   * `record_recommendation_attempt()` creates one attempt (an acceptance);
--   * `advance_recommendation_attempt()` performs ONLY validated lifecycle transitions (pending ->
--     completed/not_comparable/abandoned) and can touch ONLY the funnel columns — never the identity.
--
-- NOT APPLIED TO PRODUCTION BY THIS MIGRATION. Requires separate Product Owner authorization.
-- ROLLBACK: drop the three functions, then the attempts table, then the recommendations table.

CREATE TABLE IF NOT EXISTS public.progress_recommendations (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source_session_id    uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    formula_version      text NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),

    target_metric        text    NOT NULL,
    target_direction     text    NOT NULL,
    target_value         double precision NOT NULL,
    target_units         text    NOT NULL,
    -- DERIVED SERVER-SIDE from the eligible evaluation this recommendation is tied to (never caller
    -- input), so a later comparison is made against what the evaluation actually recorded.
    source_metric_value  double precision NOT NULL,
    shown_text           text    NOT NULL,
    shown_at             timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT prec_direction_check CHECK (target_direction IN ('decrease', 'increase', 'maintain')),
    CONSTRAINT prec_metric_check CHECK (target_metric IN ('filler_rate', 'pace', 'clear_delivery')),
    CONSTRAINT prec_source_formula_key UNIQUE (source_session_id, formula_version)
);

COMMENT ON TABLE public.progress_recommendations IS
    '#1045 immutable recommendation identity, written ONLY via record_progress_recommendation(). Tied to '
    'an eligible evaluation of a session the caller owns. Attempts live in the attempts table.';

CREATE TABLE IF NOT EXISTS public.progress_recommendation_attempts (
    id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recommendation_id          uuid NOT NULL REFERENCES public.progress_recommendations(id) ON DELETE CASCADE,
    user_id                    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    accepted_at                timestamptz NOT NULL DEFAULT now(),
    practice_session_id        uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
    next_comparable_session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
    lifecycle                  text NOT NULL DEFAULT 'pending',
    outcome                    text,
    resolved_at                timestamptz,

    CONSTRAINT prec_att_lifecycle_check
        CHECK (lifecycle IN ('pending', 'completed', 'not_comparable', 'abandoned')),
    CONSTRAINT prec_att_outcome_check
        CHECK (outcome IS NULL OR outcome IN ('moved', 'did_not_move', 'not_comparable', 'not_completed')),
    -- An outcome may only exist once resolved — a pending attempt can never count as follow-through.
    CONSTRAINT prec_att_outcome_requires_resolution
        CHECK ((outcome IS NULL AND lifecycle = 'pending') OR (outcome IS NOT NULL AND lifecycle <> 'pending'))
);

COMMENT ON TABLE public.progress_recommendation_attempts IS
    '#1045 one attempt per acceptance. Created via record_recommendation_attempt(); advanced ONLY via '
    'advance_recommendation_attempt() (validated lifecycle transitions; identity never rewritten).';

CREATE INDEX IF NOT EXISTS idx_prec_user_created
    ON public.progress_recommendations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prec_att_recommendation
    ON public.progress_recommendation_attempts (recommendation_id, accepted_at DESC);

ALTER TABLE public.progress_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress_recommendation_attempts ENABLE ROW LEVEL SECURITY;

-- READ-ONLY for clients on BOTH tables. Every write goes through an RPC below.
DROP POLICY IF EXISTS "prec_select_own" ON public.progress_recommendations;
CREATE POLICY "prec_select_own" ON public.progress_recommendations
    FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "prec_insert_own" ON public.progress_recommendations;
DROP POLICY IF EXISTS "prec_att_select_own" ON public.progress_recommendation_attempts;
CREATE POLICY "prec_att_select_own" ON public.progress_recommendation_attempts
    FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "prec_att_insert_own" ON public.progress_recommendation_attempts;
DROP POLICY IF EXISTS "prec_att_update_own" ON public.progress_recommendation_attempts;

REVOKE ALL ON public.progress_recommendations FROM PUBLIC, anon;
REVOKE ALL ON public.progress_recommendation_attempts FROM PUBLIC, anon;
GRANT SELECT ON public.progress_recommendations TO authenticated;
GRANT SELECT ON public.progress_recommendation_attempts TO authenticated;

-- ── Create the immutable recommendation. Requires an ELIGIBLE evaluation of the caller's own session. ──
CREATE OR REPLACE FUNCTION public.record_progress_recommendation(
    p_source_session_id uuid,
    p_target_metric     text,
    p_target_direction  text,
    p_target_value      double precision,
    p_target_units      text,
    p_shown_text        text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_formula constant text := 'clarity_v1';
    e         public.session_progress_evaluations%ROWTYPE;
    v_source  double precision;
    v_id uuid;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
    IF p_target_metric NOT IN ('filler_rate', 'pace', 'clear_delivery') THEN
        RAISE EXCEPTION 'invalid target metric %', p_target_metric USING ERRCODE = '22023';
    END IF;

    -- The recommendation may only be tied to an ELIGIBLE evaluation of a session THIS user owns.
    SELECT * INTO e FROM public.session_progress_evaluations
    WHERE session_id = p_source_session_id AND user_id = v_uid
      AND eligible AND formula_version = v_formula;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'no eligible evaluation for this session and user' USING ERRCODE = '42501';
    END IF;

    -- SOURCE METRIC VALUE is DERIVED from the persisted evaluation for the chosen metric — never from the
    -- caller — so a later attempt is compared against the number the evaluation actually recorded.
    v_source := CASE p_target_metric
        WHEN 'filler_rate'    THEN CASE WHEN e.word_count > 0
                                        THEN (e.filler_count::double precision / e.word_count) * 100
                                        ELSE 0 END
        WHEN 'pace'           THEN e.wpm
        WHEN 'clear_delivery' THEN e.clarity_raw
    END;
    IF v_source IS NULL THEN
        RAISE EXCEPTION 'evaluation lacks the source metric for %', p_target_metric USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.progress_recommendations (
        user_id, source_session_id, formula_version,
        target_metric, target_direction, target_value, target_units, source_metric_value, shown_text
    ) VALUES (
        v_uid, p_source_session_id, v_formula,
        p_target_metric, p_target_direction, p_target_value, p_target_units, v_source, p_shown_text
    )
    ON CONFLICT (source_session_id, formula_version) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        SELECT id INTO v_id FROM public.progress_recommendations
        WHERE source_session_id = p_source_session_id AND formula_version = v_formula AND user_id = v_uid;
    END IF;
    RETURN v_id;
END;
$$;

-- ── Accept a recommendation: create one pending attempt owned by the caller. ──
CREATE OR REPLACE FUNCTION public.record_recommendation_attempt(p_recommendation_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.progress_recommendations r
                   WHERE r.id = p_recommendation_id AND r.user_id = v_uid) THEN
        RAISE EXCEPTION 'recommendation not found for this user' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.progress_recommendation_attempts (recommendation_id, user_id)
    VALUES (p_recommendation_id, v_uid) RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- ── Advance an attempt through a VALIDATED lifecycle transition. Touches ONLY funnel columns; the
--    identity (recommendation_id, user_id, accepted_at) can never be rewritten. ──
--    The OUTCOME is never accepted from the client. For a 'completed' transition the caller supplies the
--    next practice session; the RPC verifies it is an ELIGIBLE, SAME-COHORT evaluation of the caller's own
--    session and DERIVES 'moved' / 'did_not_move' by comparing that session's metric against the
--    recommendation's recorded source value in the target direction. A directional observation only — no
--    causal claim (§8). Coherent lifecycle/session combinations are enforced.
CREATE OR REPLACE FUNCTION public.advance_recommendation_attempt(
    p_attempt_id                 uuid,
    p_lifecycle                  text,
    p_practice_session_id        uuid DEFAULT NULL,
    p_next_comparable_session_id uuid DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_current text;
    r         public.progress_recommendations%ROWTYPE;
    src       public.session_progress_evaluations%ROWTYPE;
    nxt       public.session_progress_evaluations%ROWTYPE;
    v_next_val double precision;
    v_outcome  text;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;

    SELECT lifecycle INTO v_current FROM public.progress_recommendation_attempts
    WHERE id = p_attempt_id AND user_id = v_uid;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'attempt not found for this user' USING ERRCODE = '42501';
    END IF;
    SELECT r2.* INTO r
    FROM public.progress_recommendation_attempts a
    JOIN public.progress_recommendations r2 ON r2.id = a.recommendation_id
    WHERE a.id = p_attempt_id AND a.user_id = v_uid;

    -- Only forward transitions out of pending are permitted; a resolved attempt is terminal.
    IF v_current <> 'pending' THEN
        RAISE EXCEPTION 'attempt already resolved (%); lifecycle is terminal', v_current USING ERRCODE = '22023';
    END IF;
    IF p_lifecycle NOT IN ('completed', 'not_comparable', 'abandoned') THEN
        RAISE EXCEPTION 'invalid target lifecycle %', p_lifecycle USING ERRCODE = '22023';
    END IF;

    -- Any practice / next-comparable session referenced must belong to the caller.
    IF p_practice_session_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.sessions WHERE id = p_practice_session_id AND user_id = v_uid) THEN
        RAISE EXCEPTION 'practice session not found for this user' USING ERRCODE = '42501';
    END IF;
    IF p_next_comparable_session_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.sessions WHERE id = p_next_comparable_session_id AND user_id = v_uid) THEN
        RAISE EXCEPTION 'next-comparable session not found for this user' USING ERRCODE = '42501';
    END IF;

    -- ── Coherent lifecycle/session combinations + SERVER-DERIVED outcome ──
    IF p_lifecycle = 'abandoned' THEN
        -- No comparison happened; a next-comparable session is contradictory.
        IF p_next_comparable_session_id IS NOT NULL THEN
            RAISE EXCEPTION 'abandoned attempt cannot carry a next-comparable session' USING ERRCODE = '22023';
        END IF;
        v_outcome := 'not_completed';

    ELSIF p_lifecycle = 'not_comparable' THEN
        v_outcome := 'not_comparable';

    ELSE  -- 'completed' REQUIRES a comparable next evaluation; otherwise the caller must use not_comparable.
        IF p_next_comparable_session_id IS NULL THEN
            RAISE EXCEPTION 'completed attempt requires a next-comparable session' USING ERRCODE = '22023';
        END IF;
        -- The recommendation's SOURCE evaluation (for its cohort) and the NEXT evaluation must both be the
        -- caller's own, eligible, and in the SAME cohort — else the pair is not comparable.
        SELECT * INTO src FROM public.session_progress_evaluations
        WHERE session_id = r.source_session_id AND user_id = v_uid AND eligible AND formula_version = r.formula_version;
        IF NOT FOUND THEN RAISE EXCEPTION 'source evaluation missing' USING ERRCODE = '22023'; END IF;

        SELECT * INTO nxt FROM public.session_progress_evaluations
        WHERE session_id = p_next_comparable_session_id AND user_id = v_uid AND eligible AND formula_version = r.formula_version;
        IF NOT FOUND OR nxt.cohort_key IS DISTINCT FROM src.cohort_key THEN
            RAISE EXCEPTION 'next session is not an eligible, same-cohort evaluation; use not_comparable'
                USING ERRCODE = '22023';
        END IF;

        -- The next session's value for the recommendation's metric (derived from persisted columns).
        v_next_val := CASE r.target_metric
            WHEN 'filler_rate'    THEN CASE WHEN nxt.word_count > 0
                                            THEN (nxt.filler_count::double precision / nxt.word_count) * 100 ELSE NULL END
            WHEN 'pace'           THEN nxt.wpm
            WHEN 'clear_delivery' THEN nxt.clarity_raw
        END;
        IF v_next_val IS NULL THEN RAISE EXCEPTION 'next evaluation lacks the compared metric' USING ERRCODE = '22023'; END IF;

        -- DERIVE moved / did_not_move by target direction against the recommendation's recorded source value.
        v_outcome := CASE r.target_direction
            WHEN 'decrease' THEN CASE WHEN v_next_val < r.source_metric_value THEN 'moved' ELSE 'did_not_move' END
            WHEN 'increase' THEN CASE WHEN v_next_val > r.source_metric_value THEN 'moved' ELSE 'did_not_move' END
            WHEN 'maintain' THEN CASE WHEN v_next_val >= r.source_metric_value THEN 'moved' ELSE 'did_not_move' END
        END;
    END IF;

    UPDATE public.progress_recommendation_attempts
    SET lifecycle = p_lifecycle,
        practice_session_id = COALESCE(p_practice_session_id, practice_session_id),
        next_comparable_session_id = COALESCE(p_next_comparable_session_id, next_comparable_session_id),
        outcome = v_outcome,
        resolved_at = now()
    WHERE id = p_attempt_id AND user_id = v_uid;

    RETURN v_outcome;
END;
$$;

REVOKE ALL ON FUNCTION public.record_progress_recommendation(uuid, text, text, double precision, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_recommendation_attempt(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.advance_recommendation_attempt(uuid, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_progress_recommendation(uuid, text, text, double precision, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_recommendation_attempt(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_recommendation_attempt(uuid, text, uuid, uuid) TO authenticated;
