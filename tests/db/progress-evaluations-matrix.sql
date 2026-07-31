-- Portable proof matrix for the #1045 Progress migrations. Pure SQL; runnable by psql against any
-- PostgreSQL production runs. Every check RAISEs on failure; use -v ON_ERROR_STOP=1. Disposable DB only.
-- Expects the bootstrap + both migrations applied first. Content-free: synthetic UUIDs only.

\set ON_ERROR_STOP on
\echo '=== server under test ==='
SELECT version();

INSERT INTO auth.users (id) VALUES
    ('11111111-1111-4111-8111-111111111111'),   -- victim
    ('22222222-2222-4222-8222-222222222222')    -- attacker / other user
ON CONFLICT DO NOTHING;

GRANT authenticated TO CURRENT_USER;
GRANT anon TO CURRENT_USER;

-- Superuser seed helper (bypasses RLS for setup only). Every assertion below runs as authenticated.
CREATE OR REPLACE PROCEDURE pg_temp.seed(
    p_id uuid, p_user uuid, p_words int, p_dur int, p_wpm double precision,
    p_fillers int, p_status text DEFAULT 'completed', p_attr text DEFAULT 'verified',
    p_created timestamptz DEFAULT now()
) LANGUAGE plpgsql AS $seed$
BEGIN
    INSERT INTO public.sessions (id, user_id, total_words, duration, wpm, filler_words, transcript,
                                 engine, engine_version, model_name, attribution_status, status, created_at)
    VALUES (p_id, p_user, p_words, p_dur, p_wpm,
            jsonb_build_object('um', jsonb_build_object('count', p_fillers), 'total', jsonb_build_object('count', p_fillers)),
            'a transcript', 'private', 'whisper-base.en@v2', 'whisper-base.en', p_attr, p_status, p_created);
END;
$seed$;

-- Extended seed: explicit transcript (drives server-derived error markers), explicit filler_words jsonb
-- (NULL = ABSENT evidence), and explicit engine identity (blank = incomplete). Superuser setup only.
CREATE OR REPLACE PROCEDURE pg_temp.seed_ex(
    p_id uuid, p_user uuid, p_words int, p_dur int, p_wpm double precision,
    p_filler_words jsonb, p_transcript text,
    p_engine text DEFAULT 'private', p_ev text DEFAULT 'whisper-base.en@v2',
    p_model text DEFAULT 'whisper-base.en', p_attr text DEFAULT 'verified', p_status text DEFAULT 'completed'
) LANGUAGE plpgsql AS $seedx$
BEGIN
    INSERT INTO public.sessions (id, user_id, total_words, duration, wpm, filler_words, transcript,
                                 engine, engine_version, model_name, attribution_status, status, created_at)
    VALUES (p_id, p_user, p_words, p_dur, p_wpm, p_filler_words, p_transcript,
            p_engine, p_ev, p_model, p_attr, p_status, now());
END;
$seedx$;

-- The SAME clarity formula as frontend computeClarityRaw(), used for INDEPENDENT SQL↔TS parity oracles.
CREATE OR REPLACE FUNCTION pg_temp.ts_clarity(p_words int, p_fillers int, p_errors int, p_wpm double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE AS $c$
    SELECT GREATEST(0, LEAST(100,
        100
        - ((p_fillers::double precision / p_words) * 100 * 1.5)
        - (p_errors * 3)
        - CASE WHEN p_wpm > 170 THEN LEAST(20, (p_wpm - 170) / 3)
               WHEN p_wpm > 0 AND p_wpm < 90 THEN LEAST(15, (90 - p_wpm) / 3)
               ELSE 0 END));
$c$;

DO $matrix$
DECLARE
    v_victim uuid := '11111111-1111-4111-8111-111111111111';
    v_other  uuid := '22222222-2222-4222-8222-222222222222';
    s1 uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
    s2 uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
    s3 uuid := 'aaaaaaaa-0000-4000-8000-000000000003';
    sother uuid := 'bbbbbbbb-0000-4000-8000-000000000001';
    v_eval uuid; v_rec uuid; v_att uuid;
    v_ok boolean; v_clar double precision; v_base uuid; v_prev uuid; v_err integer;
BEGIN
    -- ---- 0. security posture ----------------------------------------------------------------------
    IF NOT (SELECT prosecdef FROM pg_proc WHERE proname = 'record_progress_evaluation') THEN
        RAISE EXCEPTION 'FAIL 0: record_progress_evaluation must be SECURITY DEFINER';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'session_progress_evaluations'
              AND cmd IN ('INSERT','UPDATE','DELETE')) THEN
        RAISE EXCEPTION 'FAIL 0: evaluations table must have NO write policy (RPC-only writes)';
    END IF;
    RAISE NOTICE 'PASS 0  RPC is DEFINER; evaluations table is SELECT-only (no write policy)';

    -- ---- 1. anon/PUBLIC cannot execute the writer --------------------------------------------------
    IF EXISTS (SELECT 1 FROM information_schema.role_routine_grants
               WHERE routine_name = 'record_progress_evaluation' AND grantee IN ('anon','PUBLIC')
               AND privilege_type = 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL 1: anon/PUBLIC holds EXECUTE on the writer';
    END IF;
    RAISE NOTICE 'PASS 1  writer EXECUTE not granted to anon/PUBLIC';

    -- seed: victim has one eligible session; other user has one eligible session
    CALL pg_temp.seed(s1, v_victim, 300, 120, 140, 6, 'completed', 'verified', now() - interval '2 days');
    CALL pg_temp.seed(sother, v_other, 300, 120, 140, 6);

    -- ---- 2. a client CANNOT insert an evaluation directly (no self-asserted eligibility) ----------
    PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    SET ROLE authenticated;
    v_ok := false;
    BEGIN
        INSERT INTO public.session_progress_evaluations
            (user_id, session_id, formula_version, duration_seconds, word_count,
             clarity_evidence_available, engine, engine_version, model_name, attribution_status,
             eligible, exclusion_reasons, clarity_raw, cohort_key)
        VALUES (v_victim, s1, 'clarity_v1', 120, 300, true, 'private','v2','m','verified',
                true, '{}', 99, 'x');
    EXCEPTION WHEN insufficient_privilege OR others THEN v_ok := true;
    END;
    RESET ROLE;
    IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 2: a client inserted an evaluation directly (self-asserted eligibility)'; END IF;
    RAISE NOTICE 'PASS 2  direct client INSERT into evaluations is blocked';

    -- ---- 3. cross-user attack: victim cannot evaluate the OTHER user''s session --------------------
    PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    SET ROLE authenticated;
    v_ok := false;
    BEGIN
        PERFORM public.record_progress_evaluation(sother);
    EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
    END;
    RESET ROLE;
    IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 3: victim evaluated another user''s session'; END IF;
    RAISE NOTICE 'PASS 3  record_progress_evaluation rejects a session owned by another user';

    -- ---- 4. eligible evaluation: server computes clarity; ineligible carries reasons ---------------
    PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    SET ROLE authenticated;
    v_eval := public.record_progress_evaluation(s1);
    RESET ROLE;
    SELECT eligible, clarity_raw INTO v_ok, v_clar FROM public.session_progress_evaluations WHERE id = v_eval;
    IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 4: a valid session was not eligible'; END IF;
    -- 300 words, 6 fillers -> 2% -> 100 - 2*1.5 = 97
    IF round(v_clar::numeric, 4) <> 97.0000 THEN RAISE EXCEPTION 'FAIL 4: server clarity wrong: got %', v_clar; END IF;
    RAISE NOTICE 'PASS 4  eligible evaluation created with server-computed clarity_raw = %', v_clar;

    -- an ineligible session (too few words) -> recorded with a reason, no clarity
    CALL pg_temp.seed(s2, v_victim, 10, 5, 140, 0);
    PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    SET ROLE authenticated;
    PERFORM public.record_progress_evaluation(s2);
    RESET ROLE;
    SELECT eligible INTO v_ok FROM public.session_progress_evaluations WHERE session_id = s2;
    IF v_ok THEN RAISE EXCEPTION 'FAIL 4: a 10-word session was marked eligible'; END IF;
    IF NOT ('too_few_words' = ANY(SELECT unnest(exclusion_reasons) FROM public.session_progress_evaluations WHERE session_id = s2)) THEN
        RAISE EXCEPTION 'FAIL 4: ineligible session did not record too_few_words';
    END IF;
    RAISE NOTICE 'PASS 4b ineligible session recorded with deterministic reason, no clarity';

    -- ---- 5. baseline/previous resolved by PERSISTED created_at within the OWN cohort ---------------
    CALL pg_temp.seed(s3, v_victim, 300, 120, 140, 3, 'completed', 'verified', now());  -- newer than s1
    PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    SET ROLE authenticated;
    PERFORM public.record_progress_evaluation(s3);
    RESET ROLE;
    SELECT baseline_session_id, previous_comparable_session_id INTO v_base, v_prev
    FROM public.session_progress_evaluations WHERE session_id = s3;
    IF v_base <> s1 THEN RAISE EXCEPTION 'FAIL 5: baseline should be the OLDEST eligible session (s1), got %', v_base; END IF;
    IF v_prev <> s1 THEN RAISE EXCEPTION 'FAIL 5: previous comparable should be s1, got %', v_prev; END IF;
    RAISE NOTICE 'PASS 5  baseline/previous resolved by persisted created_at within own cohort';

    -- ---- 6. recommendation requires an eligible evaluation of the caller''s OWN session ------------
    PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    SET ROLE authenticated;
    -- other user's session has no evaluation for the victim -> rejected
    v_ok := false;
    BEGIN
        PERFORM public.record_progress_recommendation(sother, 'filler_rate','decrease',3,'percent','Pause instead of filling the gap');
    EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 6: recommendation created against a non-owned/uneligible session'; END IF;
    -- own eligible session -> succeeds. NOTE: no source metric value is passed — the RPC DERIVES it.
    v_rec := public.record_progress_recommendation(s1, 'filler_rate','decrease',3,'percent','Pause instead of filling the gap');
    RESET ROLE;
    IF v_rec IS NULL THEN RAISE EXCEPTION 'FAIL 6: recommendation not created for own eligible session'; END IF;
    -- DERIVED source metric: s1 has 6 fillers / 300 words -> 2.0% filler rate, taken from the EVALUATION.
    SELECT source_metric_value INTO v_clar FROM public.progress_recommendations WHERE id = v_rec;
    IF round(v_clar::numeric, 4) <> 2.0000 THEN
        RAISE EXCEPTION 'FAIL 6: source_metric_value must be DERIVED from the evaluation (expected 2.0), got %', v_clar;
    END IF;
    RAISE NOTICE 'PASS 6  recommendation requires own eligible eval; source metric DERIVED server-side (= %)', v_clar;

    -- ---- 7. attempts: created via RPC; identity is immutable; resolution is terminal ---------------
    PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    SET ROLE authenticated;
    v_att := public.record_recommendation_attempt(v_rec);
    -- direct UPDATE of identity must be blocked (no UPDATE grant/policy)
    v_ok := false;
    BEGIN
        UPDATE public.progress_recommendation_attempts SET recommendation_id = v_rec, accepted_at = now() WHERE id = v_att;
    EXCEPTION WHEN insufficient_privilege OR others THEN v_ok := true; END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 7: attempt identity was rewritten by a direct UPDATE'; END IF;
    -- 'completed' REQUIRES a next-comparable session (no client outcome accepted).
    v_ok := false;
    BEGIN
        PERFORM public.advance_recommendation_attempt(v_att, 'completed');  -- no next session
    EXCEPTION WHEN others THEN v_ok := true; END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 7: completed without a next-comparable session was accepted'; END IF;
    -- valid completed advance: outcome is DERIVED. s1 filler-rate source=2.0%, s3=1.0% (decrease) -> 'moved'.
    IF public.advance_recommendation_attempt(v_att, 'completed', s3, s3) <> 'moved' THEN
        RAISE EXCEPTION 'FAIL 7: server did not derive outcome=moved for an improved metric';
    END IF;
    SELECT (lifecycle = 'completed' AND outcome = 'moved') INTO v_ok
    FROM public.progress_recommendation_attempts WHERE id = v_att;
    IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 7: valid lifecycle advance did not apply'; END IF;
    -- second advance on a resolved attempt is terminal -> rejected
    v_ok := false;
    BEGIN
        PERFORM public.advance_recommendation_attempt(v_att, 'abandoned');
    EXCEPTION WHEN others THEN v_ok := true; END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 7: a resolved attempt was advanced again'; END IF;
    RESET ROLE;
    RAISE NOTICE 'PASS 7  attempts: RPC-created, identity immutable, outcome DERIVED, resolution terminal';

    -- ---- 8. cross-user: other user cannot advance the victim''s attempt ----------------------------
    PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
    SET ROLE authenticated;
    v_ok := false;
    BEGIN
        PERFORM public.advance_recommendation_attempt(v_att, 'abandoned');
    EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
    RESET ROLE;
    IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 8: another user advanced the victim''s attempt'; END IF;
    RAISE NOTICE 'PASS 8  another user cannot advance an attempt they do not own';

    -- ---- 9. SQL↔TS clarity parity: NONZERO ERRORS derived from the transcript --------------------------
    -- 300 words, 6 fillers (2%), TWO error markers in the transcript, in-range pace. Server must DERIVE the
    -- error count (never hardcode 0): 100 - 2*1.5 - 2*3 = 91, matching the TS oracle.
    CALL pg_temp.seed_ex('cccccccc-0000-4000-8000-000000000001', v_victim, 300, 120, 140,
        jsonb_build_object('total', jsonb_build_object('count', 6)),
        'hello [inaudible] world spoke clearly then [blank_audio] resumed');
    PERFORM set_config('request.jwt.claim.sub', v_victim::text, true); SET ROLE authenticated;
    PERFORM public.record_progress_evaluation('cccccccc-0000-4000-8000-000000000001'); RESET ROLE;
    SELECT clarity_raw, error_marker_count INTO v_clar, v_err
    FROM public.session_progress_evaluations WHERE session_id = 'cccccccc-0000-4000-8000-000000000001';
    IF v_err <> 2 THEN RAISE EXCEPTION 'FAIL 9: error markers not derived from transcript (expected 2), got %', v_err; END IF;
    IF round(v_clar::numeric,6) <> round(pg_temp.ts_clarity(300,6,2,140)::numeric,6) THEN
        RAISE EXCEPTION 'FAIL 9: clarity with errors % <> TS oracle %', v_clar, pg_temp.ts_clarity(300,6,2,140);
    END IF;
    IF round(v_clar::numeric,4) <> 91.0000 THEN RAISE EXCEPTION 'FAIL 9: expected 91, got %', v_clar; END IF;
    RAISE NOTICE 'PASS 9  nonzero error markers DERIVED; clarity % = TS oracle', v_clar;

    -- ---- 10. SQL↔TS parity: CLAMP-to-0, SLOW and FAST pace penalties -----------------------------------
    -- clamp: 100 words, 80 fillers -> 80% -> 120-pt penalty -> clamp 0 (a valid measured floor).
    CALL pg_temp.seed_ex('cccccccc-0000-4000-8000-000000000010', v_victim, 100, 60, 140,
        jsonb_build_object('total', jsonb_build_object('count', 80)), 'a dense transcript with many fillers');
    -- slow: 200 words, 0 fillers, 60 wpm -> penalty min(15,(90-60)/3)=10 -> 90.
    CALL pg_temp.seed_ex('cccccccc-0000-4000-8000-000000000011', v_victim, 200, 200, 60,
        jsonb_build_object('total', jsonb_build_object('count', 0)), 'a steady but slow delivery of words');
    -- fast: 200 words, 0 fillers, 230 wpm -> penalty min(20,(230-170)/3)=20 -> 80.
    CALL pg_temp.seed_ex('cccccccc-0000-4000-8000-000000000012', v_victim, 200, 52, 230,
        jsonb_build_object('total', jsonb_build_object('count', 0)), 'a very fast delivery of many words');
    PERFORM set_config('request.jwt.claim.sub', v_victim::text, true); SET ROLE authenticated;
    PERFORM public.record_progress_evaluation('cccccccc-0000-4000-8000-000000000010');
    PERFORM public.record_progress_evaluation('cccccccc-0000-4000-8000-000000000011');
    PERFORM public.record_progress_evaluation('cccccccc-0000-4000-8000-000000000012');
    RESET ROLE;
    SELECT clarity_raw INTO v_clar FROM public.session_progress_evaluations WHERE session_id = 'cccccccc-0000-4000-8000-000000000010';
    IF round(v_clar::numeric,4) <> 0.0000 OR v_clar <> pg_temp.ts_clarity(100,80,0,140) THEN RAISE EXCEPTION 'FAIL 10: clamp expected 0, got %', v_clar; END IF;
    SELECT clarity_raw INTO v_clar FROM public.session_progress_evaluations WHERE session_id = 'cccccccc-0000-4000-8000-000000000011';
    IF round(v_clar::numeric,4) <> 90.0000 OR v_clar <> pg_temp.ts_clarity(200,0,0,60) THEN RAISE EXCEPTION 'FAIL 10: slow-pace expected 90, got %', v_clar; END IF;
    SELECT clarity_raw INTO v_clar FROM public.session_progress_evaluations WHERE session_id = 'cccccccc-0000-4000-8000-000000000012';
    IF round(v_clar::numeric,4) <> 80.0000 OR v_clar <> pg_temp.ts_clarity(200,0,0,230) THEN RAISE EXCEPTION 'FAIL 10: fast-pace expected 80, got %', v_clar; END IF;
    RAISE NOTICE 'PASS 10 clamp-to-0, slow and fast pace penalties all match the TS oracle';

    -- ---- 11. MISSING filler evidence is EXCLUDED, never imputed to zero fillers ------------------------
    CALL pg_temp.seed_ex('dddddddd-0000-4000-8000-000000000001', v_victim, 300, 120, 140,
        NULL, 'a transcript with absent filler evidence');
    PERFORM set_config('request.jwt.claim.sub', v_victim::text, true); SET ROLE authenticated;
    PERFORM public.record_progress_evaluation('dddddddd-0000-4000-8000-000000000001'); RESET ROLE;
    SELECT eligible INTO v_ok FROM public.session_progress_evaluations WHERE session_id = 'dddddddd-0000-4000-8000-000000000001';
    IF v_ok THEN RAISE EXCEPTION 'FAIL 11: a session with NULL filler_words was marked eligible (imputed zero)'; END IF;
    -- Canonical §4 reason: a missing filler input is reported as no_clarity_evidence (never no_filler_evidence).
    IF NOT ('no_clarity_evidence' = ANY(SELECT unnest(exclusion_reasons) FROM public.session_progress_evaluations WHERE session_id = 'dddddddd-0000-4000-8000-000000000001')) THEN
        RAISE EXCEPTION 'FAIL 11: missing filler evidence did not record no_clarity_evidence';
    END IF;
    IF EXISTS (SELECT 1 FROM public.session_progress_evaluations WHERE session_id = 'dddddddd-0000-4000-8000-000000000001' AND filler_count IS NOT NULL) THEN
        RAISE EXCEPTION 'FAIL 11: excluded session stored a filler_count';
    END IF;
    RAISE NOTICE 'PASS 11 missing filler evidence excluded (canonical no_clarity_evidence), never imputed';

    -- ---- 12. BLANK engine identity is EXCLUDED as the canonical reason engine_not_comparable -----------
    CALL pg_temp.seed_ex('dddddddd-0000-4000-8000-000000000002', v_victim, 300, 120, 140,
        jsonb_build_object('total', jsonb_build_object('count', 6)), 'a transcript', '   ', 'v2', 'm');
    PERFORM set_config('request.jwt.claim.sub', v_victim::text, true); SET ROLE authenticated;
    PERFORM public.record_progress_evaluation('dddddddd-0000-4000-8000-000000000002'); RESET ROLE;
    SELECT eligible INTO v_ok FROM public.session_progress_evaluations WHERE session_id = 'dddddddd-0000-4000-8000-000000000002';
    IF v_ok THEN RAISE EXCEPTION 'FAIL 12: a blank-engine session was marked eligible'; END IF;
    IF NOT ('engine_not_comparable' = ANY(SELECT unnest(exclusion_reasons) FROM public.session_progress_evaluations WHERE session_id = 'dddddddd-0000-4000-8000-000000000002')) THEN
        RAISE EXCEPTION 'FAIL 12: blank engine identity did not record engine_not_comparable';
    END IF;
    RAISE NOTICE 'PASS 12 blank engine identity excluded (canonical engine_not_comparable)';

    -- ---- 13. outcome derivation: did_not_move + non-comparable rejection (server-derived, never client) -
    PERFORM set_config('request.jwt.claim.sub', v_victim::text, true); SET ROLE authenticated;
    -- New recommendation on s3 (filler-rate source = 1.0%). s1 (2.0%) is same cohort but WORSE -> did_not_move.
    v_rec := public.record_progress_recommendation(s3, 'filler_rate','decrease',3,'percent','Pause instead of filling');
    v_att := public.record_recommendation_attempt(v_rec);
    IF public.advance_recommendation_attempt(v_att, 'completed', s1, s1) <> 'did_not_move' THEN
        RAISE EXCEPTION 'FAIL 13: worse next metric did not derive did_not_move';
    END IF;
    -- A DIFFERENT-cohort next session is not comparable -> a 'completed' transition must be REJECTED.
    CALL pg_temp.seed_ex('eeeeeeee-0000-4000-8000-000000000001', v_victim, 300, 120, 140,
        jsonb_build_object('total', jsonb_build_object('count', 3)), 'a transcript', 'private', 'OTHER-VER', 'OTHER-MODEL');
    PERFORM public.record_progress_evaluation('eeeeeeee-0000-4000-8000-000000000001');
    v_att := public.record_recommendation_attempt(v_rec);  -- a fresh pending attempt on the same rec
    v_ok := false;
    BEGIN
        PERFORM public.advance_recommendation_attempt(v_att, 'completed', 'eeeeeeee-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001');
    EXCEPTION WHEN others THEN v_ok := true; END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 13: a different-cohort next session was accepted as completed'; END IF;
    -- The caller may instead resolve it as not_comparable (no client outcome).
    PERFORM public.advance_recommendation_attempt(v_att, 'not_comparable', NULL, 'eeeeeeee-0000-4000-8000-000000000001');
    SELECT (outcome = 'not_comparable') INTO v_ok FROM public.progress_recommendation_attempts WHERE id = v_att;
    IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 13: not_comparable did not derive its outcome'; END IF;
    RESET ROLE;
    RAISE NOTICE 'PASS 13 outcome derivation: did_not_move + comparability enforced; not_comparable derived';

    RAISE NOTICE '=== ALL PROGRESS MATRIX CHECKS PASSED ===';
END;
$matrix$;
