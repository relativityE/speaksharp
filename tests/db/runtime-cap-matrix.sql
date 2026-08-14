-- Disposable proof for #1290's server-authoritative 600-second per-recording boundary.
-- The surrounding harness applies the exact migration first. Synthetic rows only.
DO $$
DECLARE
  v_user uuid := '00000000-0000-0000-0000-000000001600';
  v_result jsonb;
  v_session uuid;
  v_next uuid;
  v_duration int;
  v_status text;
  v_reason text;
  v_checkpoint_total int;
BEGIN
  INSERT INTO public.user_profiles (id, subscription_status, stripe_subscription_id)
  VALUES (v_user, 'pro', 'sub_runtime_cap');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, false);

  -- The public customer default is Private. Native remains outside the database-backed customer path.
  SELECT public.update_user_usage(0) INTO v_result;
  IF v_result->>'success' <> 'true' THEN
    RAISE EXCEPTION 'default update_user_usage engine is not Private';
  END IF;

  SELECT public.create_session_and_update_usage(jsonb_build_object('duration', 601)) INTO v_result;
  IF v_result->>'error' <> 'technical_duration_cap_exceeded' THEN
    RAISE EXCEPTION 'oversized create was accepted';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sessions WHERE user_id = v_user) THEN
    RAISE EXCEPTION 'oversized create persisted a session';
  END IF;

  SELECT public.create_session_and_update_usage(jsonb_build_object('duration', 10), 'native') INTO v_result;
  IF v_result->>'error' <> 'engine_not_allowed_for_tier' THEN
    RAISE EXCEPTION 'Native customer create was accepted';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sessions WHERE user_id = v_user) THEN
    RAISE EXCEPTION 'Native customer create retained a session';
  END IF;

  SELECT public.create_session_and_update_usage(jsonb_build_object('duration', 590)) INTO v_result;
  v_session := (v_result->'new_session'->>'id')::uuid;
  IF v_session IS NULL OR v_result->>'usage_exceeded' <> 'false' THEN
    RAISE EXCEPTION '590-second Private session was not created';
  END IF;

  -- An oversized pulse may consume only the ten seconds remaining, then closes the active slot.
  SELECT public.heartbeat_session(v_session, 30) INTO v_result;
  IF v_result->>'success' <> 'true' OR v_result->>'at_cap' <> 'true'
     OR (v_result->>'accepted_seconds')::int <> 10
     OR (v_result->>'remaining_seconds')::int <> 0
     OR v_result->>'final_status' <> 'completed' THEN
    RAISE EXCEPTION 'oversized heartbeat did not converge exactly at the cap';
  END IF;
  SELECT duration, status, status_reason INTO v_duration, v_status, v_reason
    FROM public.sessions WHERE id = v_session;
  IF v_duration <> 600 OR v_status <> 'completed' OR v_reason <> 'technical_duration_cap' THEN
    RAISE EXCEPTION 'at-cap session state is not deterministic';
  END IF;
  SELECT COALESCE(sum(incremental_seconds), 0)::int INTO v_checkpoint_total
    FROM public.usage_checkpoints WHERE session_id = v_session;
  IF v_checkpoint_total <> 600 OR EXISTS (
    SELECT 1 FROM public.usage_checkpoints WHERE session_id = v_session AND incremental_seconds < 0
  ) THEN
    RAISE EXCEPTION 'usage checkpoints exceeded or disagreed with the cap';
  END IF;

  SELECT public.heartbeat_session(v_session, 30) INTO v_result;
  IF v_result->>'success' <> 'false' OR v_result->>'error' <> 'session_not_active' THEN
    RAISE EXCEPTION 'repeated heartbeat mutated a completed at-cap session';
  END IF;
  SELECT duration INTO v_duration FROM public.sessions WHERE id = v_session;
  IF v_duration <> 600 THEN
    RAISE EXCEPTION 'repeated heartbeat changed the completed duration';
  END IF;

  -- The cap transition releases concurrency immediately; the next recording starts normally.
  SELECT public.create_session_and_update_usage(jsonb_build_object('duration', 0)) INTO v_result;
  v_next := (v_result->'new_session'->>'id')::uuid;
  IF v_next IS NULL OR v_result->'new_session'->>'status' <> 'active'
     OR v_result->'new_session'->>'engine' <> 'private' THEN
    RAISE EXCEPTION 'immediate next Private recording did not start';
  END IF;
  PERFORM public.complete_session(v_next, 'completed', NULL, 0, NULL);
  SELECT public.heartbeat_session(v_next, 1) INTO v_result;
  IF v_result->>'error' <> 'session_not_active' THEN
    RAISE EXCEPTION 'heartbeat after ordinary completion was accepted';
  END IF;

  -- Exact-cap create is allowed but cannot occupy an active slot.
  SELECT public.create_session_and_update_usage(jsonb_build_object('duration', 600)) INTO v_result;
  v_next := (v_result->'new_session'->>'id')::uuid;
  IF v_result->>'at_cap' <> 'true' OR v_result->'new_session'->>'status' <> 'completed'
     OR (v_result->'new_session'->>'duration')::int <> 600 THEN
    RAISE EXCEPTION 'exact-cap create did not close deterministically';
  END IF;

  -- Completion is defense-in-depth: an adversarial final duration is clamped to 600.
  SELECT public.create_session_and_update_usage(jsonb_build_object('duration', 590)) INTO v_result;
  v_next := (v_result->'new_session'->>'id')::uuid;
  PERFORM public.complete_session(v_next, 'completed', NULL, 900, NULL);
  SELECT duration, status INTO v_duration, v_status FROM public.sessions WHERE id = v_next;
  IF v_duration <> 600 OR v_status <> 'completed' THEN
    RAISE EXCEPTION 'completion clamp failed';
  END IF;

  IF EXISTS (SELECT 1 FROM public.sessions WHERE user_id = v_user AND duration > 600)
     OR EXISTS (SELECT 1 FROM public.usage_checkpoints WHERE user_id = v_user AND incremental_seconds > 600) THEN
    RAISE EXCEPTION 'runtime cap proof found oversized persisted telemetry';
  END IF;
END $$;

SELECT 'RUNTIME 600-SECOND CAP MATRIX PASSED';
