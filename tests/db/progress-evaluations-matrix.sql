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

DO $matrix$
DECLARE
    v_victim uuid := '11111111-1111-4111-8111-111111111111';
    v_other  uuid := '22222222-2222-4222-8222-222222222222';
    s1 uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
    s2 uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
    s3 uuid := 'aaaaaaaa-0000-4000-8000-000000000003';
    sother uuid := 'bbbbbbbb-0000-4000-8000-000000000001';
    v_eval uuid; v_rec uuid; v_att uuid;
    v_ok boolean; v_clar double precision; v_base uuid; v_prev uuid;
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
        PERFORM public.record_progress_recommendation(sother, 'filler_rate','decrease',3,'percent',5,'Pause instead of filling the gap');
    EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 6: recommendation created against a non-owned/uneligible session'; END IF;
    -- own eligible session -> succeeds
    v_rec := public.record_progress_recommendation(s1, 'filler_rate','decrease',3,'percent',2,'Pause instead of filling the gap');
    RESET ROLE;
    IF v_rec IS NULL THEN RAISE EXCEPTION 'FAIL 6: recommendation not created for own eligible session'; END IF;
    RAISE NOTICE 'PASS 6  recommendation requires an eligible evaluation of the own session';

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
    -- valid lifecycle advance
    PERFORM public.advance_recommendation_attempt(v_att, 'completed', s3, s3, 'moved');
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
    RAISE NOTICE 'PASS 7  attempts: RPC-created, identity immutable, resolution terminal';

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

    RAISE NOTICE '=== ALL PROGRESS MATRIX CHECKS PASSED ===';
END;
$matrix$;
