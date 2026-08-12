-- #1265 — server-side Focus Points (objective) vs Open Mic (freeform) Progress separation.
--
-- DEFECT: record_progress_evaluation builds the comparability cohort as
--   concat_ws('|', engine, engine_version, model_name, 'clarity_v1')
-- which omits the PRACTICE MODE. Focus Points and Open Mic sessions on the same engine therefore share a
-- cohort and can be selected as each other's baseline/previous — mixing two different practice contexts.
--
-- FIX (PO-directed option b, 2026-08-12):
--   1. Fold the mode into the cohort key. Mode is read from the SERVER-OWNED objective_source_recording
--      (registered only by the FP flow via the service-role objective_register_source_v1). A session with
--      no registration is 'freeform' (Open Mic). NO mode column is added to public.sessions; the practice
--      mode is NOT coupled to the attribution authority.
--   2. Registration/evaluation RACE is handled by the CALLER: the Focus Points save flow AWAITS
--      objective_source_recording registration before invoking record_progress_evaluation; if registration
--      never lands, NO evaluation is written (better absent than mis-cohorted). Open Mic evaluates
--      immediately (it is never registered). The evaluation row stays runtime-IMMUTABLE
--      (ON CONFLICT DO NOTHING) — this migration does NOT make it mutable. (Client change is separate.)
--   3. Deterministic historical reconcile (below): backfill the mode suffix onto existing cohort_key rows
--      and drop any cross-mode baseline/previous pointer so historical comparisons are within-mode only.
--
-- Applying this migration changes only Progress comparability; it activates no billing and no capture path.

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
    v_mode       text;                       -- #1265: 'objective' (Focus Points) or 'freeform' (Open Mic)
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

    -- #1161 (P1): attribution must be TERMINAL before writing the IMMUTABLE evaluation. If neither an authority
    -- nor a definitive unattributed marker exists yet, attribution is still PENDING — DEFER (write nothing) so a
    -- later successful authority still yields the eligible row (ON CONFLICT DO NOTHING can't freeze a premature
    -- ineligible row). A definitive unattributed marker falls through and records exactly one terminal ineligible.
    IF NOT EXISTS (SELECT 1 FROM public.session_attribution_authority a
                   WHERE a.session_id = p_session_id AND a.user_id = v_uid)
       AND NOT EXISTS (SELECT 1 FROM public.session_attribution_unattributed u
                       WHERE u.session_id = p_session_id AND u.user_id = v_uid) THEN
        RETURN NULL;   -- attribution pending; a later call re-evaluates
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
    -- #1161: eligibility gates on the server-RECORDED declaration verdict (version-locked, owner-scoped),
    -- NOT the client-writable sessions.attribution_status. Fail-closed: no attrib_v1 record => unverified.
    IF NOT EXISTS (SELECT 1 FROM public.session_attribution_authority a
        WHERE a.session_id = p_session_id AND a.user_id = v_uid AND a.authority_version = 'attrib_v1')
    THEN v_reasons := array_append(v_reasons, 'unverified_attribution'); END IF;
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
        -- #1265: PRACTICE MODE token. 'objective' iff this recording is server-registered as a Focus
        -- Points source (objective_source_recording); otherwise 'freeform' (Open Mic). Owner-scoped read.
        -- The caller awaits registration before evaluating a Focus Points session, so this read is
        -- authoritative; an unregistered session is genuinely freeform.
        v_mode := CASE WHEN EXISTS (
            SELECT 1 FROM public.objective_source_recording o
            WHERE o.session_id = p_session_id AND o.user_id = v_uid
        ) THEN 'objective' ELSE 'freeform' END;
        v_cohort := concat_ws('|', s.engine, s.engine_version, s.model_name, v_formula, v_mode);

        -- Baseline / previous chosen by PERSISTED created_at within the CALLER'S OWN cohort. Cannot
        -- reference another user's session (user_id = v_uid) and cannot be caller-ordered. The moded
        -- cohort_key now also confines the selection to the SAME practice mode.
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
        -- #1161 P1 (terminal-retention): the stored attribution_status is derived SOLELY from the server-recorded
        -- declaration verdict, NEVER from the client-writable s.attribution_status. By the defer guard above, this
        -- INSERT is only reached once attribution is RESOLVED — so a recorded row ⇒ 'verified', and its definitive
        -- absence (an unattributed marker exists) ⇒ a hard 'unverified'. Echoing s.attribution_status here would let
        -- a forged 'verified' survive into the evaluation row; drop that fallback entirely.
        v_has_clarity, s.engine, s.engine_version, s.model_name, CASE WHEN EXISTS (SELECT 1 FROM public.session_attribution_authority a
        WHERE a.session_id = p_session_id AND a.user_id = v_uid AND a.authority_version = 'attrib_v1')
          THEN 'verified' ELSE 'unverified' END,
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

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Deterministic historical reconcile (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- (a) Append the mode suffix onto existing cohort_key rows that predate #1265 (exactly 4 pipe parts:
--     engine|version|model|formula). After this they carry the 5th mode part. Guarded so re-running is a
--     no-op (already-moded rows have 5 parts and are skipped).
UPDATE public.session_progress_evaluations e
SET cohort_key = e.cohort_key || '|' ||
    CASE WHEN EXISTS (SELECT 1 FROM public.objective_source_recording o WHERE o.session_id = e.session_id)
         THEN 'objective' ELSE 'freeform' END
WHERE e.cohort_key IS NOT NULL
  AND array_length(string_to_array(e.cohort_key, '|'), 1) = 4;

-- (b) REBUILD each eligible row's baseline/previous pointer from the earliest/latest eligible session in
--     the SAME (user, moded cohort_key) created strictly BEFORE it. This preserves legitimate within-mode
--     comparisons across interleaved histories (objective A, freeform B, objective C -> C.baseline =
--     C.previous = A) and eliminates every cross-mode pointer (a different-mode session has a different
--     cohort_key and is never selected). Mirrors the evaluator's own selection (earliest = baseline,
--     most-recent-prior = previous), computed over the full history. Deterministic + idempotent.
UPDATE public.session_progress_evaluations e
SET baseline_session_id = (
        SELECT o.session_id
        FROM public.session_progress_evaluations o
        JOIN public.sessions os ON os.id = o.session_id
        JOIN public.sessions es ON es.id = e.session_id
        WHERE o.user_id = e.user_id AND o.eligible AND o.cohort_key = e.cohort_key
          AND o.session_id <> e.session_id AND os.created_at < es.created_at
        ORDER BY os.created_at ASC
        LIMIT 1
    ),
    previous_comparable_session_id = (
        SELECT o.session_id
        FROM public.session_progress_evaluations o
        JOIN public.sessions os ON os.id = o.session_id
        JOIN public.sessions es ON es.id = e.session_id
        WHERE o.user_id = e.user_id AND o.eligible AND o.cohort_key = e.cohort_key
          AND o.session_id <> e.session_id AND os.created_at < es.created_at
        ORDER BY os.created_at DESC
        LIMIT 1
    )
WHERE e.eligible;
