-- #1261 proof matrix (disposable Postgres only).
--
-- Run AFTER the remediation migration: every assertion must pass.
-- Run WITHOUT the migration (falsification): it must FAIL, because anon still inherits the PUBLIC grant.
--
-- Positive: each proven caller retains EXECUTE. Negative: anon/PUBLIC executes nothing, trigger functions
-- grant no role direct EXECUTE, and every one of the 16 SECURITY DEFINER functions ends its search_path in
-- pg_temp.

DO $$
DECLARE
  bad text := '';
  auth_rpcs text[] := ARRAY[
    'public.update_user_usage(integer)',
    'public.has_objective_capability()',
    'public.objective_start_session_v1(uuid, uuid, uuid, text, text, text)',
    'public.objective_finalize_evidence_v1(uuid, jsonb)',
    'public.objective_select_action_v1(uuid)',
    'public.objective_dispute_action_v1(uuid)',
    'public.objective_register_source_v1(uuid)',
    'public.acquire_recording_lease(uuid, text, boolean)',
    'public.heartbeat_recording_lease(uuid)',
    'public.release_recording_lease(uuid)'
  ];
  maint text[] := ARRAY[
    'public.cleanup_expired_sessions()',
    'public.expire_stale_sessions()',
    'public.purge_derived_content_on_expire()',
    'public.redeem_promo(text, uuid)'
  ];
  triggers text[] := ARRAY[
    'public.handle_new_user()',
    'public.ensure_trial_profile_for_new_user()'
  ];
  sig text;
  unsafe text;
BEGIN
  -- NEGATIVE — anon must execute NONE of the 16.
  FOREACH sig IN ARRAY (auth_rpcs || maint || triggers) LOOP
    IF has_function_privilege('anon', sig, 'EXECUTE') THEN bad := bad || 'anon-can:' || sig || ' '; END IF;
    IF has_function_privilege('public', sig, 'EXECUTE') THEN bad := bad || 'public-can:' || sig || ' '; END IF;
  END LOOP;

  -- POSITIVE — authenticated retains the client RPCs.
  FOREACH sig IN ARRAY auth_rpcs LOOP
    IF NOT has_function_privilege('authenticated', sig, 'EXECUTE') THEN bad := bad || 'auth-missing:' || sig || ' '; END IF;
  END LOOP;

  -- POSITIVE — service_role retains the maintenance functions; authenticated must NOT.
  FOREACH sig IN ARRAY maint LOOP
    IF NOT has_function_privilege('service_role', sig, 'EXECUTE') THEN bad := bad || 'svc-missing:' || sig || ' '; END IF;
    IF has_function_privilege('authenticated', sig, 'EXECUTE') THEN bad := bad || 'auth-should-not:' || sig || ' '; END IF;
  END LOOP;

  -- NEGATIVE — trigger functions grant no direct EXECUTE to authenticated or service_role.
  FOREACH sig IN ARRAY triggers LOOP
    IF has_function_privilege('authenticated', sig, 'EXECUTE') THEN bad := bad || 'trigger-auth:' || sig || ' '; END IF;
    IF has_function_privilege('service_role', sig, 'EXECUTE') THEN bad := bad || 'trigger-svc:' || sig || ' '; END IF;
  END LOOP;

  -- SEARCH_PATH — every one of the 16 must end its search_path in pg_temp (whitespace-insensitive).
  SELECT string_agg(p.proname, ' ') INTO unsafe
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef
    AND p.proname IN ('update_user_usage','has_objective_capability','objective_start_session_v1',
      'objective_finalize_evidence_v1','objective_select_action_v1','objective_dispute_action_v1',
      'objective_register_source_v1','acquire_recording_lease','heartbeat_recording_lease',
      'release_recording_lease','cleanup_expired_sessions','expire_stale_sessions',
      'purge_derived_content_on_expire','redeem_promo','handle_new_user','ensure_trial_profile_for_new_user')
    AND NOT EXISTS (
      SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c
      WHERE regexp_replace(c, '\s', '', 'g') ~ 'search_path=.*,?pg_temp$');
  IF unsafe IS NOT NULL THEN bad := bad || 'unsafe-search-path:' || unsafe || ' '; END IF;

  IF bad <> '' THEN RAISE EXCEPTION '#1261 PROOF FAILED: %', bad; END IF;
  RAISE NOTICE 'ALL #1261 SECDEF GRANT PROOFS PASSED';
END $$;

SELECT '#1261 SECDEF GRANT PROOF COMPLETE' AS banner;
