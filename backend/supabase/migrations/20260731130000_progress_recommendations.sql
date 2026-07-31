-- #1045 PR-C — durable recommendation identity + one-to-many attempts.
--
-- Implements `product_release/PROGRESS_AND_NEXT_ACTION.md` §8 (recommendation/attempt records) and the
-- follow-through measurement. Additive only; no existing table is altered.
--
-- WHY TWO TABLES. A single `try_next_target` on the evaluation cannot represent reality: a user may click
-- "Practice this next" repeatedly, abandon an attempt, change engine mid-way, or receive several
-- recommendations over time. Collapsing that into one column silently mis-attributes the wrong session
-- to the wrong recommendation. So:
--   * `progress_recommendations` is IMMUTABLE and identifies WHAT was recommended and from which session;
--   * `progress_recommendation_attempts` is one-to-many and records each ACCEPTANCE and its outcome.
--
-- WHAT THIS MEASURES (the business question): recommendation shown -> accepted -> practice started ->
-- next comparable session completed -> did the targeted metric move in the recommended direction.
-- `outcome` is a DIRECTIONAL OBSERVATION ONLY. The product must never claim the recommendation CAUSED
-- the change, and nothing in this schema licenses that claim.
--
-- NOT APPLIED TO PRODUCTION BY THIS PR. Requires separate Product Owner migration approval.
--
-- ROLLBACK: DROP TABLE progress_recommendation_attempts, then progress_recommendations. Additive, and
-- nothing else reads them; dropping loses only follow-through evidence.

CREATE TABLE IF NOT EXISTS public.progress_recommendations (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- The session this recommendation was derived FROM.
    source_session_id    uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    formula_version      text NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),

    -- What was recommended, and the evidence it came from.
    target_metric        text    NOT NULL,
    target_direction     text    NOT NULL,
    target_value         double precision NOT NULL,
    target_units         text    NOT NULL,
    -- The source metric value at the time of the recommendation, and its version, so a later comparison
    -- is made against what was ACTUALLY shown rather than a recomputed number.
    source_metric_value  double precision,
    -- The exact copy shown, so the funnel can be read without guessing what the user saw.
    shown_text           text    NOT NULL,
    shown_at             timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT progress_recommendations_direction_check
        CHECK (target_direction IN ('decrease', 'increase', 'maintain')),
    -- One recommendation per source session per formula version: re-rendering a session must not mint a
    -- second identity for the same advice.
    CONSTRAINT progress_recommendations_source_formula_key UNIQUE (source_session_id, formula_version)
);

COMMENT ON TABLE public.progress_recommendations IS
    '#1045 immutable recommendation identity: what was recommended, from which session, with the copy '
    'actually shown. Attempts live in progress_recommendation_attempts (one-to-many).';

CREATE TABLE IF NOT EXISTS public.progress_recommendation_attempts (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recommendation_id        uuid NOT NULL REFERENCES public.progress_recommendations(id) ON DELETE CASCADE,
    user_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Funnel: accepted -> practice started -> next comparable completed -> did the target move.
    accepted_at              timestamptz NOT NULL DEFAULT now(),
    practice_session_id      uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
    next_comparable_session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
    lifecycle                text NOT NULL DEFAULT 'pending',
    outcome                  text,
    resolved_at              timestamptz,

    CONSTRAINT progress_recommendation_attempts_lifecycle_check
        CHECK (lifecycle IN ('pending', 'completed', 'not_comparable', 'abandoned')),
    CONSTRAINT progress_recommendation_attempts_outcome_check
        CHECK (outcome IS NULL OR outcome IN ('moved', 'did_not_move', 'not_comparable', 'not_completed')),
    -- An outcome may only exist once the attempt has actually resolved. This is what stops a pending
    -- attempt from being counted as evidence of follow-through.
    CONSTRAINT progress_recommendation_attempts_outcome_requires_resolution
        CHECK ((outcome IS NULL AND lifecycle = 'pending') OR (outcome IS NOT NULL AND lifecycle <> 'pending'))
);

COMMENT ON TABLE public.progress_recommendation_attempts IS
    '#1045 one attempt per acceptance of a recommendation. Handles repeat clicks, abandonment and engine '
    'changes without mis-attributing a session. outcome is a DIRECTIONAL OBSERVATION, never a causal claim.';

CREATE INDEX IF NOT EXISTS idx_prec_user_created
    ON public.progress_recommendations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prec_attempts_recommendation
    ON public.progress_recommendation_attempts (recommendation_id, accepted_at DESC);

ALTER TABLE public.progress_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress_recommendation_attempts ENABLE ROW LEVEL SECURITY;

-- Per-user isolation, matching sessions. Recommendations are immutable (no UPDATE policy); attempts may
-- be updated by their owner because their lifecycle legitimately advances pending -> resolved.
DROP POLICY IF EXISTS "prec_select_own" ON public.progress_recommendations;
CREATE POLICY "prec_select_own" ON public.progress_recommendations
    FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "prec_insert_own" ON public.progress_recommendations;
CREATE POLICY "prec_insert_own" ON public.progress_recommendations
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "prec_att_select_own" ON public.progress_recommendation_attempts;
CREATE POLICY "prec_att_select_own" ON public.progress_recommendation_attempts
    FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "prec_att_insert_own" ON public.progress_recommendation_attempts;
CREATE POLICY "prec_att_insert_own" ON public.progress_recommendation_attempts
    FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "prec_att_update_own" ON public.progress_recommendation_attempts;
CREATE POLICY "prec_att_update_own" ON public.progress_recommendation_attempts
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON public.progress_recommendations FROM PUBLIC;
REVOKE ALL ON public.progress_recommendations FROM anon;
REVOKE ALL ON public.progress_recommendation_attempts FROM PUBLIC;
REVOKE ALL ON public.progress_recommendation_attempts FROM anon;
GRANT SELECT, INSERT ON public.progress_recommendations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.progress_recommendation_attempts TO authenticated;
