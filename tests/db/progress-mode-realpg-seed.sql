\set ON_ERROR_STOP on

INSERT INTO auth.users (id) VALUES ('11111111-1111-4111-8111-111111111111') ON CONFLICT DO NOTHING;

INSERT INTO public.sessions (
    id, user_id, status, duration, total_words, wpm, transcript, filler_words,
    engine, engine_version, model_name, device_type, attribution_status, created_at
) VALUES
    ('00000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'completed', 120, 150, 120, 'synthetic words only', '{"total":{"count":5}}', 'private-v2', 'v2', 'base', 'cpu', 'pending', '2026-08-12T12:00:00Z'),
    ('00000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111', 'completed', 120, 150, 120, 'synthetic words only', '{"total":{"count":5}}', 'private-v2', 'v2', 'base', 'cpu', 'pending', '2026-08-12T12:00:00Z'),
    ('00000000-0000-4000-8000-0000000000c1', '11111111-1111-4111-8111-111111111111', 'completed', 120, 150, 120, 'synthetic words only', '{"total":{"count":5}}', 'private-v2', 'v2', 'base', 'cpu', 'pending', '2026-08-12T12:00:00Z'),
    ('00000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'completed', 120, 150, 120, 'synthetic words only', '{"total":{"count":5}}', 'private-v2', 'v2', 'base', 'cpu', 'pending', '2026-08-12T12:00:00Z')
ON CONFLICT DO NOTHING;

INSERT INTO public.session_attribution_authority
    (session_id, user_id, engine_class, engine, engine_version, model_id, provider, resolved_device)
SELECT id, user_id, 'private', 'private', engine_version, model_name, 'transformers-js', device_type
FROM public.sessions
WHERE id IN (
    '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1',
    '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000d1'
)
ON CONFLICT DO NOTHING;

-- A/C are Focus Points. The pre-#1265 evaluator still ignores this marker and writes four-part cohorts.
INSERT INTO public.objective_source_recording (session_id, user_id) VALUES
    ('00000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111'),
    ('00000000-0000-4000-8000-0000000000c1', '11111111-1111-4111-8111-111111111111')
ON CONFLICT DO NOTHING;

SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
SET ROLE authenticated;
SELECT public.record_progress_evaluation('00000000-0000-4000-8000-0000000000a1');
SELECT public.record_progress_evaluation('00000000-0000-4000-8000-0000000000b1');
SELECT public.record_progress_evaluation('00000000-0000-4000-8000-0000000000c1');
SELECT public.record_progress_evaluation('00000000-0000-4000-8000-0000000000d1');
RESET ROLE;
