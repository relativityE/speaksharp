\set ON_ERROR_STOP on
\echo '=== #1282 commercial trial matrix ==='

DO $matrix$
DECLARE
  v_fn regprocedure;
  v_config text;
  v_result jsonb;
  v_engines text[];
  v_count int;
  v_marker timestamptz;
  v_expiry timestamptz;
  v_user_new uuid := '00000000-0000-4000-8000-000000001282';
  v_user_legacy uuid := '00000000-0000-4000-8000-000000001283';
  v_user_paid uuid := '00000000-0000-4000-8000-000000001284';
BEGIN
  -- Exact Private-only entitlement authority.
  SELECT allowed_engines INTO STRICT v_engines
    FROM public.tier_configs WHERE tier_name = 'pro';
  IF v_engines IS DISTINCT FROM ARRAY['private']::text[] THEN
    RAISE EXCEPTION 'customer engine allow-list is not exactly private: %', v_engines;
  END IF;

  -- New-account trigger grants one marked, 30-day server window.
  INSERT INTO auth.users(id) VALUES (v_user_new);
  SELECT commercial_trial_granted_at, trial_expires_at
    INTO STRICT v_marker, v_expiry
    FROM public.user_profiles WHERE id = v_user_new;
  IF v_marker IS NULL OR v_expiry <> v_marker + interval '30 days' THEN
    RAISE EXCEPTION 'new account did not receive exact marked 30-day window';
  END IF;

  BEGIN
    UPDATE public.user_profiles SET commercial_trial_granted_at = NULL WHERE id = v_user_new;
    RAISE EXCEPTION 'immutable marker update unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'commercial_trial_granted_at is immutable' THEN RAISE; END IF;
  END;

  -- The legacy row was stamped exactly once by the activation migration; the paid row was untouched.
  SELECT commercial_trial_granted_at, trial_expires_at
    INTO STRICT v_marker, v_expiry
    FROM public.user_profiles WHERE id = v_user_legacy;
  IF v_marker IS NULL OR v_expiry <> v_marker + interval '30 days' THEN
    RAISE EXCEPTION 'legacy account did not receive exact one-time window';
  END IF;
  SELECT count(*)::int INTO v_count FROM public.user_profiles
    WHERE id = v_user_paid AND subscription_status = 'pro'
      AND stripe_subscription_id = 'sub_matrix_paid' AND commercial_trial_granted_at IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'paid account was mutated by activation'; END IF;

  -- SECURITY DEFINER fixed paths and least-privilege ACLs.
  FOREACH v_fn IN ARRAY ARRAY[
    'public.update_user_usage(integer,text,uuid)'::regprocedure,
    'public.check_usage_limit()'::regprocedure,
    'public.complete_session(uuid,text,text,integer,text)'::regprocedure
  ] LOOP
    SELECT array_to_string(proconfig, ',') INTO v_config FROM pg_proc WHERE oid = v_fn::oid;
    IF replace(COALESCE(v_config, ''), ' ', '') <> 'search_path=public,pg_temp' THEN
      RAISE EXCEPTION 'unsafe search_path on %: %', v_fn, v_config;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'client/service ACL mismatch on %', v_fn;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_proc p,
        LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
      WHERE p.oid = v_fn::oid AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    ) THEN RAISE EXCEPTION 'PUBLIC can execute %', v_fn; END IF;
  END LOOP;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.ensure_trial_profile_for_new_user()'::regprocedure,
    'public.preserve_commercial_trial_grant()'::regprocedure
  ] LOOP
    SELECT array_to_string(proconfig, ',') INTO v_config FROM pg_proc WHERE oid = v_fn::oid;
    IF replace(COALESCE(v_config, ''), ' ', '') <> 'search_path=public,pg_temp' THEN
      RAISE EXCEPTION 'unsafe trigger search_path on %: %', v_fn, v_config;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'trigger function has a direct role grant: %', v_fn;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_proc p,
        LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
      WHERE p.oid = v_fn::oid AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    ) THEN RAISE EXCEPTION 'PUBLIC can execute trigger function %', v_fn; END IF;
  END LOOP;

  -- Former sample/daily/monthly exhaustion cannot deny an entitled trial.
  UPDATE public.user_profiles
     SET private_sample_seconds_used = 300,
         daily_usage_seconds = 7201,
         native_usage_seconds = 180001,
         cloud_usage_seconds = 180001
   WHERE id = v_user_new;
  PERFORM set_config('request.jwt.claim.sub', v_user_new::text, false);
  SELECT public.update_user_usage(60, 'private', gen_random_uuid()) INTO v_result;
  IF v_result->>'success' <> 'true' THEN
    RAISE EXCEPTION 'legacy accumulated usage denied active trial: %', v_result;
  END IF;
  SELECT public.update_user_usage(1, 'native', gen_random_uuid()) INTO v_result;
  IF v_result->>'error' <> 'engine_not_allowed_for_tier' THEN
    RAISE EXCEPTION 'Native customer entitlement was accepted';
  END IF;
  SELECT public.update_user_usage(1, 'transformers-js-v4', gen_random_uuid()) INTO v_result;
  IF v_result->>'error' <> 'engine_not_allowed_for_tier' THEN
    RAISE EXCEPTION 'Private implementation variant was accepted as entitlement';
  END IF;

  -- Client clock is inert; exact server expiry denies start and save while existing rows remain readable.
  PERFORM set_config('app.client_now', '2099-01-01T00:00:00Z', false);
  SELECT public.update_user_usage(1, 'private', gen_random_uuid()) INTO v_result;
  IF v_result->>'success' <> 'true' THEN RAISE EXCEPTION 'client clock shortened live trial'; END IF;

  INSERT INTO public.sessions(id, user_id, duration, transcript, status)
  VALUES ('00000000-0000-4000-8000-000000001299', v_user_new, 30, 'synthetic retained row', 'active');
  UPDATE public.user_profiles SET trial_expires_at = statement_timestamp() WHERE id = v_user_new;
  SELECT public.check_usage_limit() INTO v_result;
  IF v_result->>'can_start' <> 'false' OR v_result->>'error' <> 'trial_expired' THEN
    RAISE EXCEPTION 'exact expiry did not deny creation';
  END IF;
  SELECT public.complete_session(
    '00000000-0000-4000-8000-000000001299', 'completed', 'must not persist', 60, NULL
  ) INTO v_result;
  IF v_result->>'error' <> 'trial_expired' THEN RAISE EXCEPTION 'exact expiry did not deny save'; END IF;
  SELECT count(*)::int INTO v_count FROM public.sessions
   WHERE id = '00000000-0000-4000-8000-000000001299'
     AND transcript = 'synthetic retained row';
  IF v_count <> 1 THEN RAISE EXCEPTION 'expired user lost retained session read access'; END IF;
END;
$matrix$;

SELECT 'TRIAL COMMERCIAL MATRIX PASSED' AS result;
