-- Outcome 4 D2: behaviour smoke on the Supabase database image, through the shipped save path.
-- Run by tests/db/manual/repeat-practised-tip-supabase-replay.sh after every migration is applied. Never run it on a
-- shared or production database: it creates a synthetic account and sessions.
--
-- It repeats the core of the PGlite real-save suite (tests 1 and 2) on the real image, with Supabase's own roles,
-- auth schema and non-superuser `postgres`, one statement per transaction (as the app's calls are):
--   1. Practice again on the newest saved, coached session copies its tip.
--   2. The repeat's real save binds the copy BEFORE retention expires the original and purges its review.
--   3. The next real save expires the repeat and deletes the copy.
-- It also checks what a client can do with the new columns: the owner reads them, another account and anon read
-- nothing, and the owner can neither write a tip nor insert an attempt directly.
-- Content-free: synthetic identifiers and one synthetic tip.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned

CREATE FUNCTION pg_temp.check(ok boolean, label text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
    IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL  %', label; END IF;
    RETURN 'PASS  ' || label;
END $f$;

SELECT public.activate_transcript_retention_newest_one() IS NOT NULL AS activated \gset
SELECT 'aaaaaaaa-0000-4000-8000-0000000000d2'::uuid AS uid, 'bbbbbbbb-0000-4000-8000-0000000000d2'::uuid AS other \gset
INSERT INTO auth.users (id, email) VALUES (:'uid', 'd2-owner@example.test'), (:'other', 'd2-other@example.test');

-- ── take A: lease, create, save, release (as the owner) ──
SELECT set_config('request.jwt.claim.sub', :'uid', false) \g /dev/null
SET ROLE authenticated;
SELECT gen_random_uuid() AS lease_a \gset
SELECT (public.acquire_recording_lease(:'lease_a'::uuid, 'd2', false)->>'acquired')::boolean AS ok \gset
SELECT public.create_session_and_update_usage(jsonb_build_object('title','d2','duration',0,'total_words',0,'lease_id',:'lease_a'), 'private')->'new_session'->>'id' AS a \gset
SELECT (public.complete_session_v2(p_session_id => :'a'::uuid, p_status => 'completed', p_final_duration => 60,
    p_next_action => '{"reasonCode":"HIGH_FILLER_RATE","actionCode":"REDUCE_FILLERS","metric":"filler_rate","value":0.08,"comparator":"above_baseline","templateVersion":"rec_v1"}'::jsonb,
    p_total_words => 120, p_clarity_score => 80, p_wpm => 130, p_filler_counts => '{"um":3}'::jsonb,
    p_final_transcript => 'synthetic words for take a')->>'success')::boolean AS saved_a \gset
SELECT public.release_recording_lease(:'lease_a'::uuid) \g /dev/null
RESET ROLE;

-- Coaching and the engine attestation, written as the service side does.
UPDATE public.sessions SET ai_suggestions = '{"version":"gemini_coaching_v1","what_worked":"The opening was concrete.","what_to_try_next":"Pause before you name the price."}'::jsonb,
       engine = 'private', engine_version = 'v4', model_name = 'synthetic-model' WHERE id = :'a';
INSERT INTO public.session_attribution_authority (session_id, user_id, engine_class, engine, engine_version, model_id, provider)
VALUES (:'a', :'uid', 'private', 'private', 'v4', 'synthetic-model', 'transformers-js-v4');

-- ── Practice again on A ──
SET ROLE authenticated;
SELECT public.record_progress_evaluation(:'a'::uuid) AS eval_a \gset
SELECT public.record_progress_recommendation(:'a'::uuid, 'filler_rate', 'decrease', 3, 'percent of words', 'Cut fillers') AS rec \gset
SELECT public.record_recommendation_attempt(:'rec'::uuid) AS attempt \gset
RESET ROLE;
SELECT pg_temp.check(:'saved_a'::boolean AND (SELECT eligible FROM public.session_progress_evaluations WHERE id = :'eval_a'),
    'take A saved through complete_session_v2 and its evaluation is eligible');
SELECT pg_temp.check((SELECT practised_tip = 'Pause before you name the price.' AND tip_session_id IS NULL AND lifecycle = 'pending'
    FROM public.progress_recommendation_attempts WHERE id = :'attempt'), 'Practice again on the newest coached session copies its tip');

-- Event log: in which order the repeat's save binds and expires.
CREATE TABLE public.d2_smoke_event_log (seq bigserial PRIMARY KEY, event text, ref uuid);
CREATE FUNCTION public.d2_smoke_log_bind() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
    IF NEW.tip_session_id IS DISTINCT FROM OLD.tip_session_id THEN INSERT INTO public.d2_smoke_event_log(event, ref) VALUES ('bound', NEW.tip_session_id); END IF;
    RETURN NULL; END $f$;
CREATE TRIGGER d2_smoke_log_bind AFTER UPDATE ON public.progress_recommendation_attempts FOR EACH ROW EXECUTE FUNCTION public.d2_smoke_log_bind();
CREATE FUNCTION public.d2_smoke_log_expire() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
    IF NEW.transcript_state = 'expired' AND OLD.transcript_state IS DISTINCT FROM 'expired' THEN INSERT INTO public.d2_smoke_event_log(event, ref) VALUES ('expired', NEW.id); END IF;
    RETURN NULL; END $f$;
CREATE TRIGGER d2_smoke_log_expire AFTER UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.d2_smoke_log_expire();
-- authenticated writes the log through the triggers it fires.
GRANT INSERT ON public.d2_smoke_event_log TO authenticated;
GRANT USAGE ON SEQUENCE public.d2_smoke_event_log_seq_seq TO authenticated;

-- ── take B, the repeat ──
SET ROLE authenticated;
SELECT gen_random_uuid() AS lease_b \gset
SELECT (public.acquire_recording_lease(:'lease_b'::uuid, 'd2', false)->>'acquired')::boolean AS ok \gset
SELECT public.create_session_and_update_usage(jsonb_build_object('title','d2','duration',0,'total_words',0,'lease_id',:'lease_b'), 'private')->'new_session'->>'id' AS b \gset
SELECT (public.complete_session_v2(p_session_id => :'b'::uuid, p_status => 'completed', p_final_duration => 60,
    p_next_action => '{"reasonCode":"HIGH_FILLER_RATE","actionCode":"REDUCE_FILLERS","metric":"filler_rate","value":0.08,"comparator":"above_baseline","templateVersion":"rec_v1"}'::jsonb,
    p_total_words => 120, p_clarity_score => 80, p_wpm => 130, p_filler_counts => '{"um":3}'::jsonb,
    p_final_transcript => 'synthetic words for take b')->>'success')::boolean AS saved_b \gset
SELECT public.release_recording_lease(:'lease_b'::uuid) \g /dev/null
RESET ROLE;
SELECT pg_temp.check((SELECT transcript_state = 'expired' AND transcript IS NULL AND ai_suggestions IS NULL FROM public.sessions WHERE id = :'a'),
    'the repeat''s real save expired A and purged its review');
SELECT pg_temp.check((SELECT array_agg(event || ':' || ref ORDER BY seq) FROM public.d2_smoke_event_log) = ARRAY['bound:' || :'b', 'expired:' || :'a'],
    'inside that save, B was bound before A expired');
SELECT pg_temp.check((SELECT practised_tip = 'Pause before you name the price.' AND tip_session_id = :'b'::uuid
    FROM public.progress_recommendation_attempts WHERE id = :'attempt'), 'the tip survives the save, bound to the repeat');

-- ── the client's advance after the save ──
SET ROLE authenticated;
SELECT public.record_progress_evaluation(:'b'::uuid) \g /dev/null
SELECT public.advance_recommendation_attempt(:'attempt'::uuid, 'not_comparable', :'b'::uuid, NULL) AS lifecycle \gset
RESET ROLE;
SELECT pg_temp.check((SELECT practised_tip = 'Pause before you name the price.' AND tip_session_id = :'b'::uuid AND practice_session_id = :'b'::uuid
    FROM public.progress_recommendation_attempts WHERE id = :'attempt'), 'the advance keeps the bound tip');

-- ── what clients can do with the new columns ──
SET ROLE authenticated;
SELECT count(*) AS owner_rows FROM public.progress_recommendation_attempts WHERE id = :'attempt' AND practised_tip IS NOT NULL \gset
UPDATE public.progress_recommendation_attempts SET practised_tip = 'Client-written text.' WHERE id = :'attempt';
SELECT count(*) AS owner_writes FROM public.progress_recommendation_attempts WHERE id = :'attempt' AND practised_tip = 'Client-written text.' \gset
\echo '(the next statement is expected to be refused)'
\set ON_ERROR_STOP 0
\set insert_denied 0
INSERT INTO public.progress_recommendation_attempts (user_id, recommendation_id, practised_tip) VALUES (:'uid', :'rec', 'Client-written text.');
\if :ERROR
  \set insert_denied 1
\endif
\set ON_ERROR_STOP 1
SELECT set_config('request.jwt.claim.sub', :'other', false) \g /dev/null
SELECT count(*) AS other_rows FROM public.progress_recommendation_attempts WHERE id = :'attempt' \gset
RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', false) \g /dev/null
\echo '(the next statement is expected to be refused)'
\set ON_ERROR_STOP 0
\set anon_rows denied
SELECT count(*) AS anon_rows FROM public.progress_recommendation_attempts WHERE id = :'attempt' \gset
\set ON_ERROR_STOP 1
RESET ROLE;
SELECT pg_temp.check(:owner_rows = 1, 'the owner reads the tip (existing owner-only RLS select)');
SELECT pg_temp.check(:owner_writes = 0, 'the owner cannot write a tip (no update policy)');
SELECT pg_temp.check(:insert_denied = 1, 'the owner cannot insert an attempt directly (no insert policy)');
SELECT pg_temp.check(:other_rows = 0, 'another account reads nothing');
SELECT pg_temp.check(:'anon_rows' IN ('0', 'denied'), 'anon reads nothing (result: ' || :'anon_rows' || ')');

-- ── take C: the next real save expires the repeat and deletes the copy ──
SELECT set_config('request.jwt.claim.sub', :'uid', false) \g /dev/null
SET ROLE authenticated;
SELECT gen_random_uuid() AS lease_c \gset
SELECT (public.acquire_recording_lease(:'lease_c'::uuid, 'd2', false)->>'acquired')::boolean AS ok \gset
SELECT public.create_session_and_update_usage(jsonb_build_object('title','d2','duration',0,'total_words',0,'lease_id',:'lease_c'), 'private')->'new_session'->>'id' AS c \gset
SELECT (public.complete_session_v2(p_session_id => :'c'::uuid, p_status => 'completed', p_final_duration => 60,
    p_next_action => '{"reasonCode":"HIGH_FILLER_RATE","actionCode":"REDUCE_FILLERS","metric":"filler_rate","value":0.08,"comparator":"above_baseline","templateVersion":"rec_v1"}'::jsonb,
    p_total_words => 120, p_clarity_score => 80, p_wpm => 130, p_filler_counts => '{"um":3}'::jsonb,
    p_final_transcript => 'synthetic words for take c')->>'success')::boolean AS saved_c \gset
SELECT public.release_recording_lease(:'lease_c'::uuid) \g /dev/null
RESET ROLE;
SELECT pg_temp.check((SELECT transcript_state = 'expired' FROM public.sessions WHERE id = :'b'), 'the next real save expired the repeat');
SELECT pg_temp.check((SELECT practised_tip IS NULL AND tip_session_id = :'b'::uuid FROM public.progress_recommendation_attempts WHERE id = :'attempt'),
    'and the copy is deleted');

-- Leave nothing behind but the synthetic rows: drop the smoke's own log.
DROP TRIGGER d2_smoke_log_bind ON public.progress_recommendation_attempts;
DROP TRIGGER d2_smoke_log_expire ON public.sessions;
DROP FUNCTION public.d2_smoke_log_bind();
DROP FUNCTION public.d2_smoke_log_expire();
DROP TABLE public.d2_smoke_event_log;
SELECT 'D2 SUPABASE SMOKE PASSED';
