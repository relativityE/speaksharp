\set ON_ERROR_STOP on
\echo '=== #1265 Progress mode/chronology matrix ==='
SELECT version();

DO $matrix$
DECLARE
    v_ok boolean;
BEGIN
    SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']::text[] INTO v_ok
    FROM pg_proc WHERE oid = 'public.record_progress_evaluation(uuid)'::regprocedure;
    IF v_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'SECURITY DEFINER/search_path contract failed'; END IF;
    IF EXISTS (
           SELECT 1 FROM pg_proc p,
               LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
           WHERE p.oid = 'public.record_progress_evaluation(uuid)'::regprocedure
             AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
       )
       OR has_function_privilege('anon', 'public.record_progress_evaluation(uuid)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.record_progress_evaluation(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'record_progress_evaluation execute ACL contract failed';
    END IF;

    -- Backfill tuple chronology: A/C are objective; B/D are freeform, all at the same timestamp.
    IF NOT EXISTS (SELECT 1 FROM public.session_progress_evaluations WHERE session_id='00000000-0000-4000-8000-0000000000a1' AND cohort_key LIKE '%|objective' AND baseline_session_id IS NULL AND previous_comparable_session_id IS NULL)
       OR NOT EXISTS (SELECT 1 FROM public.session_progress_evaluations WHERE session_id='00000000-0000-4000-8000-0000000000b1' AND cohort_key LIKE '%|freeform' AND baseline_session_id IS NULL AND previous_comparable_session_id IS NULL)
       OR NOT EXISTS (SELECT 1 FROM public.session_progress_evaluations WHERE session_id='00000000-0000-4000-8000-0000000000c1' AND baseline_session_id='00000000-0000-4000-8000-0000000000a1' AND previous_comparable_session_id='00000000-0000-4000-8000-0000000000a1')
       OR NOT EXISTS (SELECT 1 FROM public.session_progress_evaluations WHERE session_id='00000000-0000-4000-8000-0000000000d1' AND baseline_session_id='00000000-0000-4000-8000-0000000000b1' AND previous_comparable_session_id='00000000-0000-4000-8000-0000000000b1') THEN
        RAISE EXCEPTION 'equal-timestamp A/B/C/D backfill chronology failed';
    END IF;
END;
$matrix$;

-- Runtime continuation E/F at the same timestamp must extend the repaired same-mode chains.
INSERT INTO public.sessions (
    id, user_id, status, duration, total_words, wpm, transcript, filler_words,
    engine, engine_version, model_name, device_type, attribution_status, created_at
) VALUES
    ('00000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'completed', 120, 150, 120, 'synthetic words only', '{"total":{"count":5}}', 'private-v2', 'v2', 'base', 'cpu', 'pending', '2026-08-12T12:00:00Z'),
    ('00000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111', 'completed', 120, 150, 120, 'synthetic words only', '{"total":{"count":5}}', 'private-v2', 'v2', 'base', 'cpu', 'pending', '2026-08-12T12:00:00Z')
ON CONFLICT DO NOTHING;
INSERT INTO public.session_attribution_authority
    (session_id, user_id, engine_class, engine, engine_version, model_id, provider, resolved_device)
SELECT id, user_id, 'private', 'private', engine_version, model_name, 'transformers-js', device_type
FROM public.sessions WHERE id IN ('00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000f1')
ON CONFLICT DO NOTHING;
INSERT INTO public.objective_source_recording (session_id, user_id)
VALUES ('00000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111') ON CONFLICT DO NOTHING;

SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
SET ROLE authenticated;
SELECT public.record_progress_evaluation('00000000-0000-4000-8000-0000000000e1');
SELECT public.record_progress_evaluation('00000000-0000-4000-8000-0000000000f1');
RESET ROLE;

DO $runtime$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.session_progress_evaluations WHERE session_id='00000000-0000-4000-8000-0000000000e1' AND baseline_session_id='00000000-0000-4000-8000-0000000000a1' AND previous_comparable_session_id='00000000-0000-4000-8000-0000000000c1')
       OR NOT EXISTS (SELECT 1 FROM public.session_progress_evaluations WHERE session_id='00000000-0000-4000-8000-0000000000f1' AND baseline_session_id='00000000-0000-4000-8000-0000000000b1' AND previous_comparable_session_id='00000000-0000-4000-8000-0000000000d1') THEN
        RAISE EXCEPTION 'runtime same-mode tuple continuation failed';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.session_progress_evaluations e
        JOIN public.session_progress_evaluations r
          ON r.session_id IN (e.baseline_session_id, e.previous_comparable_session_id)
        WHERE e.eligible AND split_part(e.cohort_key, '|', 5) <> split_part(r.cohort_key, '|', 5)
    ) THEN RAISE EXCEPTION 'cross-mode pointer survived'; END IF;
END;
$runtime$;

\echo 'PROGRESS MODE MATRIX COMPLETE'
