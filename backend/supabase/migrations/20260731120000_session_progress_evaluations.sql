-- #1045 — immutable, versioned Progress evaluation records, written ONLY through a guarded RPC.
--
-- Implements `product_release/PROGRESS_AND_NEXT_ACTION.md` §4/§5/§8. Additive only: no existing table is
-- altered and no existing row is ever rewritten. `public.sessions.clarity_score` keeps its rounded
-- historical values — raw evidence is FUTURE-ONLY (§5). Historical backfill is NOT part of v1.
--
-- ── WHY CLIENTS CANNOT INSERT ──
-- An RLS `WITH CHECK (auth.uid() = user_id)` only proves the row CLAIMS the caller. It does NOT stop a
-- caller from referencing ANOTHER user's session, nor from asserting `eligible = true` with a fabricated
-- `clarity_raw`. Progress evidence would then be self-asserted rather than derived, and because the
-- records are immutable a bad row could never be corrected.
--
-- Therefore the table grants SELECT only, and every write goes through `record_progress_evaluation()`,
-- which derives the owner from `auth.uid()`, verifies the session (and its baseline/previous references)
-- belong to that owner, computes eligibility AND the unrounded clear-delivery value SERVER-SIDE from
-- persisted columns, resolves baseline/previous by PERSISTED `created_at` (never caller ordering), and is
-- idempotent per (session, formula_version).
--
-- NOT APPLIED TO PRODUCTION BY THIS MIGRATION. Requires separate Product Owner authorization.
-- ROLLBACK: drop the function, then the table. Additive; nothing else reads them.

CREATE TABLE IF NOT EXISTS public.session_progress_evaluations (
    id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id                     uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,

    -- Always recorded: the facts needed to PROVE an eligibility decision or an exclusion afterwards.
    formula_version                text        NOT NULL,
    evaluated_at                   timestamptz NOT NULL DEFAULT now(),
    duration_seconds               numeric     NOT NULL,
    word_count                     integer     NOT NULL,
    clarity_evidence_available     boolean     NOT NULL,
    engine                         text,
    engine_version                 text,
    model_name                     text,
    attribution_status             text,
    eligible                       boolean     NOT NULL,
    exclusion_reasons              text[]      NOT NULL DEFAULT '{}',

    -- Eligible-only.
    clarity_raw                    double precision,
    filler_count                   integer,
    error_marker_count             integer,
    wpm                            double precision,
    cohort_key                     text,
    baseline_session_id            uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
    previous_comparable_session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,

    CONSTRAINT spe_session_formula_key UNIQUE (session_id, formula_version),

    CONSTRAINT spe_exclusion_consistency CHECK (
        (eligible = true  AND cardinality(exclusion_reasons) = 0)
        OR
        (eligible = false AND cardinality(exclusion_reasons) > 0)
    ),

    -- An eligible row MUST carry complete evidence, a COMPLETE (non-blank) engine identity, verified
    -- attribution, and a filler_count derived from present evidence (never an imputed zero); an
    -- ineligible row must carry no comparison references or evidence it has not earned.
    CONSTRAINT spe_eligible_payload CHECK (
        (eligible = true
            AND clarity_raw IS NOT NULL AND cohort_key IS NOT NULL
            AND filler_count IS NOT NULL AND error_marker_count IS NOT NULL
            AND engine IS NOT NULL AND btrim(engine) <> ''
            AND engine_version IS NOT NULL AND btrim(engine_version) <> ''
            AND model_name IS NOT NULL AND btrim(model_name) <> ''
            AND attribution_status = 'verified')
        OR
        (eligible = false
            AND baseline_session_id IS NULL AND previous_comparable_session_id IS NULL
            AND clarity_raw IS NULL AND cohort_key IS NULL)
    ),

    CONSTRAINT spe_clarity_range CHECK (clarity_raw IS NULL OR (clarity_raw >= 0 AND clarity_raw <= 100)),

    CONSTRAINT spe_no_self_reference CHECK (
        (baseline_session_id IS NULL OR baseline_session_id <> session_id)
        AND (previous_comparable_session_id IS NULL OR previous_comparable_session_id <> session_id)
    )
);

COMMENT ON TABLE public.session_progress_evaluations IS
    '#1045 immutable, versioned Progress evaluation per completed session. Written ONLY via '
    'record_progress_evaluation(); clients have SELECT only. Ineligible rows carry deterministic '
    'exclusion reasons; only eligible rows carry evidence, cohort and comparison references.';

CREATE INDEX IF NOT EXISTS idx_spe_user_cohort_evaluated
    ON public.session_progress_evaluations (user_id, cohort_key, evaluated_at DESC)
    WHERE eligible = true;
CREATE INDEX IF NOT EXISTS idx_spe_session ON public.session_progress_evaluations (session_id);

ALTER TABLE public.session_progress_evaluations ENABLE ROW LEVEL SECURITY;

-- READ-ONLY for clients. No INSERT/UPDATE/DELETE policy: writes happen only through the guarded RPC, and
-- the records are immutable once written. Deletion happens only by FK cascade with the session/account.
DROP POLICY IF EXISTS "spe_select_own" ON public.session_progress_evaluations;
CREATE POLICY "spe_select_own" ON public.session_progress_evaluations
    FOR SELECT USING (auth.uid() = user_id);

REVOKE ALL ON public.session_progress_evaluations FROM PUBLIC;
REVOKE ALL ON public.session_progress_evaluations FROM anon;
GRANT SELECT ON public.session_progress_evaluations TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- Guarded writer. SECURITY DEFINER so it can enforce what RLS cannot; pinned search_path; PUBLIC/anon
-- revoked. Takes ONLY a session id — every other value is derived, so a caller can neither claim another
-- user's session nor self-assert eligibility. Idempotent per (session, formula_version).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_progress_evaluation(p_session_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid        uuid := auth.uid();
    v_formula    constant text := 'clarity_v1';
    v_min_secs   constant numeric := 30;    -- §4 STRUCTURAL eligibility gate (not product policy)
    v_min_words  constant integer := 75;    -- §4 STRUCTURAL eligibility gate (not product policy)
    s            public.sessions%ROWTYPE;
    v_reasons    text[] := ARRAY[]::text[];
    v_eligible   boolean;
    v_words      integer;
    v_fillers    integer;
    v_errors     integer;                    -- DERIVED from the persisted transcript; never hardcoded
    v_has_filler_evidence boolean;           -- present, usable filler evidence (a valid zero counts; NULL/empty does not)
    v_wpm        double precision;
    v_has_clarity boolean;
    v_clarity    double precision;
    v_cohort     text;
    v_baseline   uuid;
    v_previous   uuid;
    v_id         uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
    END IF;

    -- OWNERSHIP: the session must belong to the caller. This is the check an RLS WITH CHECK cannot make.
    SELECT * INTO s FROM public.sessions WHERE id = p_session_id AND user_id = v_uid;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'session not found for this user' USING ERRCODE = '42501';
    END IF;

    v_words := COALESCE(s.total_words, 0);
    v_wpm := s.wpm;

    -- FILLER EVIDENCE (must never be imputed). filler_words is {word:{count:N}} with a 'total' aggregate
    -- key. Evidence is USABLE only when the object exists AND carries a numeric total.count OR at least one
    -- numeric entry — mirroring frontend isUsableFillerCounts(). A missing/blank/malformed object is
    -- ABSENT evidence, not zero fillers.
    v_has_filler_evidence := s.filler_words IS NOT NULL AND jsonb_typeof(s.filler_words) = 'object' AND (
        (jsonb_typeof(s.filler_words->'total') = 'object'
            AND (s.filler_words->'total' ? 'count')
            AND jsonb_typeof(s.filler_words->'total'->'count') = 'number')
        OR EXISTS (
            SELECT 1 FROM jsonb_each(s.filler_words) AS v(key, value)
            WHERE v.key <> 'total' AND jsonb_typeof(v.value) = 'object'
              AND (v.value ? 'count') AND jsonb_typeof(v.value->'count') = 'number')
    );

    -- Filler total, derived ONLY when evidence is present: prefer the persisted total.count (mirrors
    -- frontend getFillerTotal), else sum the non-total entries. NULL when evidence is absent — clarity
    -- is then never computed and the session is excluded with reason 'no_filler_evidence'.
    IF v_has_filler_evidence THEN
        v_fillers := COALESCE(
            NULLIF(s.filler_words->'total'->>'count', '')::int,
            (SELECT SUM((v.value->>'count')::int)
             FROM jsonb_each(s.filler_words) AS v(key, value)
             WHERE v.key <> 'total' AND jsonb_typeof(v.value) = 'object' AND (v.value ? 'count')),
            0);
    ELSE
        v_fillers := NULL;
    END IF;

    -- ERROR MARKERS: DERIVED server-side from the persisted transcript with the SAME pattern as the
    -- frontend ERROR_TAG_REGEX. This is a real clarity input; it is never hardcoded to zero.
    v_errors := (
        SELECT count(*)::int FROM regexp_matches(
            COALESCE(s.transcript, ''),
            '\[(inaudible|blank_audio|music|applause|laughter|noise|mumbles)\]',
            'gi') AS m
    );

    v_has_clarity := (s.transcript IS NOT NULL AND length(btrim(s.transcript)) > 0)
                     AND v_words > 0 AND v_wpm IS NOT NULL AND v_has_filler_evidence;

    -- §4 gates, evaluated SERVER-SIDE; deterministic reasons recorded for audit.
    IF s.status IS DISTINCT FROM 'completed'            THEN v_reasons := array_append(v_reasons, 'not_completed'); END IF;
    IF COALESCE(s.duration, 0) < v_min_secs             THEN v_reasons := array_append(v_reasons, 'too_short'); END IF;
    IF v_words < v_min_words                            THEN v_reasons := array_append(v_reasons, 'too_few_words'); END IF;
    IF s.transcript IS NULL OR length(btrim(s.transcript)) = 0
                                                        THEN v_reasons := array_append(v_reasons, 'no_transcript'); END IF;
    -- Missing filler evidence is a MISSING CLARITY INPUT (v_has_clarity depends on it), reported with the
    -- canonical §4 reason 'no_clarity_evidence' — never imputed to zero, and no separate reason token.
    IF NOT v_has_clarity                                THEN v_reasons := array_append(v_reasons, 'no_clarity_evidence'); END IF;
    IF s.attribution_status IS DISTINCT FROM 'verified' THEN v_reasons := array_append(v_reasons, 'unverified_attribution'); END IF;
    -- Engine identity must be COMPLETE and non-blank (null OR empty/whitespace is incomplete); the
    -- canonical §4 reason for an unusable identity is 'engine_not_comparable'.
    IF s.engine IS NULL OR btrim(s.engine) = ''
       OR s.engine_version IS NULL OR btrim(s.engine_version) = ''
       OR s.model_name IS NULL OR btrim(s.model_name) = ''
                                                        THEN v_reasons := array_append(v_reasons, 'engine_not_comparable'); END IF;

    SELECT ARRAY(SELECT DISTINCT unnest(v_reasons) ORDER BY 1) INTO v_reasons;
    v_eligible := cardinality(v_reasons) = 0;

    IF v_eligible THEN
        -- Clear delivery, UNROUNDED, from persisted columns. Mirrors frontend computeClarityRaw();
        -- a SQL↔TS parity test asserts they agree.
        v_clarity := GREATEST(0, LEAST(100,
            100
            - ((v_fillers::double precision / v_words) * 100 * 1.5)
            - (v_errors * 3)
            - CASE
                WHEN v_wpm > 170 THEN LEAST(20, (v_wpm - 170) / 3)
                WHEN v_wpm > 0 AND v_wpm < 90 THEN LEAST(15, (90 - v_wpm) / 3)
                ELSE 0
              END
        ));
        v_cohort := concat_ws('|', s.engine, s.engine_version, s.model_name, v_formula);

        -- Baseline / previous chosen by PERSISTED created_at within the CALLER'S OWN cohort. Cannot
        -- reference another user's session (user_id = v_uid) and cannot be caller-ordered.
        SELECT e.session_id INTO v_baseline
        FROM public.session_progress_evaluations e
        JOIN public.sessions cs ON cs.id = e.session_id
        WHERE e.user_id = v_uid AND e.eligible AND e.cohort_key = v_cohort AND e.session_id <> p_session_id
        ORDER BY cs.created_at ASC
        LIMIT 1;

        SELECT e.session_id INTO v_previous
        FROM public.session_progress_evaluations e
        JOIN public.sessions cs ON cs.id = e.session_id
        WHERE e.user_id = v_uid AND e.eligible AND e.cohort_key = v_cohort AND e.session_id <> p_session_id
        ORDER BY cs.created_at DESC
        LIMIT 1;
    END IF;

    INSERT INTO public.session_progress_evaluations (
        user_id, session_id, formula_version, duration_seconds, word_count,
        clarity_evidence_available, engine, engine_version, model_name, attribution_status,
        eligible, exclusion_reasons,
        clarity_raw, filler_count, error_marker_count, wpm, cohort_key,
        baseline_session_id, previous_comparable_session_id
    ) VALUES (
        v_uid, p_session_id, v_formula, COALESCE(s.duration, 0), v_words,
        v_has_clarity, s.engine, s.engine_version, s.model_name, s.attribution_status,
        v_eligible, v_reasons,
        CASE WHEN v_eligible THEN v_clarity END,
        CASE WHEN v_eligible THEN v_fillers END,
        CASE WHEN v_eligible THEN v_errors END,
        CASE WHEN v_eligible THEN v_wpm END,
        CASE WHEN v_eligible THEN v_cohort END,
        v_baseline, v_previous
    )
    ON CONFLICT (session_id, formula_version) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        SELECT id INTO v_id FROM public.session_progress_evaluations
        WHERE session_id = p_session_id AND formula_version = v_formula;
    END IF;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_progress_evaluation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_progress_evaluation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_progress_evaluation(uuid) TO authenticated;
