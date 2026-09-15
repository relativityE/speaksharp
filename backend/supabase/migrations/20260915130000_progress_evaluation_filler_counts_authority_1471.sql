-- #1471 — Progress evaluation reads the current filler evidence authority and never writes NULL evidence.
--
-- DEFECT (Production 576c4712, every save): record_progress_evaluation derived filler evidence solely from legacy
-- sessions.filler_words. The save path strips that blob (storage.ts CONTENT_FIELDS) and the RPC stores '{}', for which
-- the predicate is NULL; IF NOT v_has_clarity appends no reason and the INSERT writes NULL into NOT NULL
-- clarity_evidence_available -> 23502. The client then records rpc_error Progress debt and holds the next Start ~30 s.
--
-- FIX (one CREATE OR REPLACE of this function; generated from 20260812030000's text with four asserted replacements):
--   1. filler evidence/count come from sessions.filler_counts via public._ss_valid_filler_total (20260817140000), and
--      only a POSITIVE valid total is observed evidence; legacy filler_words is consulted only when filler_counts IS
--      NULL, and only on an affirmative numeric count;
--   2. v_has_clarity is COALESCEd to false, and the INSERT writes COALESCE(v_has_clarity, false);
--   3. absent/malformed/zero-total evidence => clarity_evidence_available = false, ineligible, 'no_clarity_evidence',
--      no score. A zero total ({} included) is UNOBSERVABLE here: nothing persisted proves the detector was able to
--      observe, and a false clean zero is the higher-severity failure. The verified zero is owned by #1472's
--      persisted completeness authority; this function does not manufacture it.
-- UNCHANGED: signature, SECURITY DEFINER, search_path, ownership, attribution defer/verdict, §4 gates, clarity formula,
-- #1265 mode/cohort selection, idempotent ON CONFLICT, and the function ACL (CREATE OR REPLACE keeps existing grants;
-- none are restated). NOT applied to Production by merging; application requires separate authorization.
-- ROLLBACK: re-run the record_progress_evaluation definition from 20260812030000_progress_cohort_mode_separation_1265.sql.

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
    v_has_filler_evidence boolean;           -- affirmative filler evidence (a positive valid count; NULL/malformed/zero does not)
    v_filler_total bigint;                   -- #1471: _ss_valid_filler_total(filler_counts); NULL = not measured / malformed
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

    -- #1471 FILLER EVIDENCE AUTHORITY (must never be imputed).
    -- Current saves persist filler evidence ONLY in sessions.filler_counts (#1306): a flat map of approved keys. The
    -- save writes {} both when the detector observed zero fillers and when it could not observe at all, so {} alone
    -- proves nothing. The legacy filler_words blob is stripped at the save boundary and stored as '{}' — which the old
    -- predicate evaluated to NULL (three-valued logic), so every current save wrote NULL into NOT NULL
    -- clarity_evidence_available and failed 23502.
    -- CURRENT EVIDENCE ALWAYS WINS: a non-null filler_counts is judged only by the shared validity helper
    -- _ss_valid_filler_total (NULL when malformed; {} -> 0; otherwise the sum). Only a POSITIVE total within the integer
    -- range is affirmative evidence; NULL, malformed, out-of-range and ZERO totals are unobservable (#1471 PM RETURN
    -- 5682372478 — a verified zero needs #1472's separate persisted completeness authority). Only when filler_counts IS
    -- NULL (a pre-#1306 row) may evidence fall back to legacy filler_words, and only on an AFFIRMATIVE numeric count:
    -- an empty legacy object is never a clean zero.
    IF s.filler_counts IS NOT NULL THEN
        v_filler_total := public._ss_valid_filler_total(s.filler_counts);
        v_has_filler_evidence := v_filler_total IS NOT NULL AND v_filler_total > 0 AND v_filler_total <= 2147483647;
        v_fillers := CASE WHEN v_has_filler_evidence THEN v_filler_total::int END;
    ELSE
        v_has_filler_evidence := COALESCE(s.filler_words IS NOT NULL AND jsonb_typeof(s.filler_words) = 'object' AND (
            (jsonb_typeof(s.filler_words->'total') = 'object'
                AND (s.filler_words->'total' ? 'count')
                AND jsonb_typeof(s.filler_words->'total'->'count') = 'number')
            OR EXISTS (
                SELECT 1 FROM jsonb_each(s.filler_words) AS v(key, value)
                WHERE v.key <> 'total' AND jsonb_typeof(v.value) = 'object'
                  AND (v.value ? 'count') AND jsonb_typeof(v.value->'count') = 'number')
        ), false);
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
    END IF;

    -- ERROR MARKERS: DERIVED server-side from the persisted transcript with the SAME pattern as the
    -- frontend ERROR_TAG_REGEX. This is a real clarity input; it is never hardcoded to zero.
    v_errors := (
        SELECT count(*)::int FROM regexp_matches(
            COALESCE(s.transcript, ''),
            '\[(inaudible|blank_audio|music|applause|laughter|noise|mumbles)\]',
            'gi') AS m
    );

    -- #1471: explicitly two-valued; no NOT NULL evidence column may ever receive NULL from this predicate.
    v_has_clarity := COALESCE((s.transcript IS NOT NULL AND length(btrim(s.transcript)) > 0)
                     AND v_words > 0 AND v_wpm IS NOT NULL AND v_has_filler_evidence, false);

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
        WHERE e.user_id = v_uid AND e.eligible AND e.cohort_key = v_cohort
          AND (cs.created_at, e.session_id) < (s.created_at, p_session_id)
        ORDER BY cs.created_at ASC, e.session_id ASC
        LIMIT 1;

        SELECT e.session_id INTO v_previous
        FROM public.session_progress_evaluations e
        JOIN public.sessions cs ON cs.id = e.session_id
        WHERE e.user_id = v_uid AND e.eligible AND e.cohort_key = v_cohort
          AND (cs.created_at, e.session_id) < (s.created_at, p_session_id)
        ORDER BY cs.created_at DESC, e.session_id DESC
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
        COALESCE(v_has_clarity, false), s.engine, s.engine_version, s.model_name, CASE WHEN EXISTS (SELECT 1 FROM public.session_attribution_authority a
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
