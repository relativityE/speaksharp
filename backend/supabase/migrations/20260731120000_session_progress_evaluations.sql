-- #1045 PR-B — immutable, versioned Progress evaluation records.
--
-- Implements `product_release/PROGRESS_AND_NEXT_ACTION.md` §8. Additive only: NO existing table is
-- altered and NO existing row is ever rewritten. In particular `public.sessions.clarity_score` keeps its
-- rounded historical values untouched — raw evidence is FUTURE-ONLY, from the first eligible session
-- evaluated after activation (§5 baseline policy).
--
-- ONE RECORD PER PERSISTED COMPLETED SESSION, eligible or not. §4 requires a deterministic exclusion
-- reason for every session that cannot influence Progress, and §8 requires that an exclusion be
-- auditable later from the record alone rather than recomputed from mutable state. A single table
-- carrying both outcomes is the only way those two rules stay consistent:
--   * ALWAYS recorded: session id, evidence availability, engine/version/model, attribution status,
--     duration, word count, formula version, evaluated_at, eligible, exclusion_reasons.
--   * ONLY when eligible: the unrounded clear-delivery value and its inputs, the cohort key, and the
--     baseline / previous-comparable references.
--
-- WHY unrounded: `calculateClarityScore()` rounds to an integer and that integer is what users see and
-- what `sessions.clarity_score` persists. `clarity_raw` stores the pre-round value so a comparison is
-- computed from full precision. Whether a sub-point difference is SHOWN as movement is the
-- meaningful-movement PRODUCT POLICY, not a property of the number.
--
-- WHY model_name is in the cohort: `engine_version` is not proven to identify the producing model —
-- `sessions` stores the two independently — so version alone could silently mix two models.
--
-- ISOLATION: per-user RLS, matching `sessions`. A user may read and insert only their own evaluations.
-- There is deliberately NO update/delete policy: these records are IMMUTABLE. A corrected evaluation is
-- a new row with a new formula_version, never an edit — that is what makes a displayed number traceable
-- to the exact evidence and formula that produced it.
--
-- NOT APPLIED TO PRODUCTION BY THIS PR. Requires separate Product Owner migration approval.
--
-- ROLLBACK: `DROP TABLE public.session_progress_evaluations;`. The table is additive and nothing else
-- reads it until PR-C ships, so dropping it loses only Progress evidence — no session, transcript or
-- entitlement data is affected.

CREATE TABLE IF NOT EXISTS public.session_progress_evaluations (
    id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id                     uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,

    -- ── Always recorded (needed to PROVE an eligibility decision or an exclusion afterwards) ──
    formula_version                text        NOT NULL,
    evaluated_at                   timestamptz NOT NULL DEFAULT now(),
    snapshot_origin                text        NOT NULL DEFAULT 'at_save',
    duration_seconds               numeric     NOT NULL,
    word_count                     integer     NOT NULL,
    -- The FACT that clear-delivery evidence was present or absent — never the transcript itself.
    clarity_evidence_available     boolean     NOT NULL,
    engine                         text,
    engine_version                 text,
    model_name                     text,
    attribution_status             text,
    eligible                       boolean     NOT NULL,
    exclusion_reasons              text[]      NOT NULL DEFAULT '{}',

    -- ── Only when eligible = true (§8) ──
    clarity_raw                    double precision,
    filler_count                   integer,
    error_marker_count             integer,
    wpm                            double precision,
    cohort_key                     text,
    baseline_session_id            uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
    previous_comparable_session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,

    -- One evaluation per session per formula version. A re-evaluation under a NEW version is a new row;
    -- re-running the SAME version must not silently create a second, divergent record.
    CONSTRAINT session_progress_evaluations_session_formula_key UNIQUE (session_id, formula_version),

    CONSTRAINT session_progress_evaluations_origin_check
        CHECK (snapshot_origin IN ('at_save', 'historical_backfill')),

    -- An ineligible record MUST carry at least one reason; an eligible one must carry none. This is the
    -- database-level guarantee that "why was this session not counted?" is always answerable.
    CONSTRAINT session_progress_evaluations_exclusion_consistency
        CHECK (
            (eligible = true  AND cardinality(exclusion_reasons) = 0)
            OR
            (eligible = false AND cardinality(exclusion_reasons) > 0)
        ),

    -- Eligible records must carry the evidence and cohort that make them comparable; ineligible records
    -- must NOT carry baseline / previous-comparable references (§8: those are eligible-only).
    CONSTRAINT session_progress_evaluations_eligible_payload
        CHECK (
            (eligible = true  AND clarity_raw IS NOT NULL AND cohort_key IS NOT NULL)
            OR
            (eligible = false AND baseline_session_id IS NULL AND previous_comparable_session_id IS NULL)
        ),

    -- Clear delivery is a 0-100 measure; a value outside that range is a bug, not data.
    CONSTRAINT session_progress_evaluations_clarity_range
        CHECK (clarity_raw IS NULL OR (clarity_raw >= 0 AND clarity_raw <= 100))
);

COMMENT ON TABLE public.session_progress_evaluations IS
    '#1045 immutable, versioned Progress evaluation per persisted completed session. One row per '
    '(session, formula_version). Ineligible rows record deterministic exclusion reasons; only eligible '
    'rows carry unrounded evidence, cohort and baseline/previous-comparable references. Never updated.';

-- Reading a user''s Progress means walking their own evaluations newest-first within a cohort.
CREATE INDEX IF NOT EXISTS idx_spe_user_cohort_evaluated
    ON public.session_progress_evaluations (user_id, cohort_key, evaluated_at DESC)
    WHERE eligible = true;

CREATE INDEX IF NOT EXISTS idx_spe_session
    ON public.session_progress_evaluations (session_id);

ALTER TABLE public.session_progress_evaluations ENABLE ROW LEVEL SECURITY;

-- Per-user isolation, matching `sessions`. SELECT + INSERT only: no UPDATE and no DELETE policy exists,
-- so the records are immutable from the client. Deletion happens only by FK cascade when the owning
-- session or account is removed.
DROP POLICY IF EXISTS "spe_select_own" ON public.session_progress_evaluations;
CREATE POLICY "spe_select_own" ON public.session_progress_evaluations
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "spe_insert_own" ON public.session_progress_evaluations;
CREATE POLICY "spe_insert_own" ON public.session_progress_evaluations
    FOR INSERT WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON public.session_progress_evaluations FROM PUBLIC;
REVOKE ALL ON public.session_progress_evaluations FROM anon;
GRANT SELECT, INSERT ON public.session_progress_evaluations TO authenticated;
