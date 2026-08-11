\set ON_ERROR_STOP on

DO $$
DECLARE
  signature text;
  function_oid oid;
BEGIN
  IF to_regprocedure('public.redeem_promo(text,uuid)') IS NOT NULL
     OR to_regprocedure('public.handle_new_user()') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback recreated a hosted-only function';
  END IF;

  FOREACH signature IN ARRAY ARRAY[
    'public.has_objective_capability()',
    'public.objective_start_session_v1(uuid,uuid,uuid,text,text,text)',
    'public.objective_finalize_evidence_v1(uuid,jsonb)',
    'public.objective_select_action_v1(uuid)',
    'public.objective_dispute_action_v1(uuid)',
    'public.objective_register_source_v1(uuid)',
    'public.acquire_recording_lease(uuid,text,boolean)',
    'public.heartbeat_recording_lease(uuid)',
    'public.release_recording_lease(uuid)',
    'public.update_user_usage(integer)',
    'public.cleanup_expired_sessions()',
    'public.expire_stale_sessions()',
    'public.purge_derived_content_on_expire()',
    'public.ensure_trial_profile_for_new_user()'
  ] LOOP
    function_oid := to_regprocedure(signature);
    IF function_oid IS NULL THEN RAISE EXCEPTION 'repository-owned function missing after rollback: %', signature; END IF;
    IF NOT has_function_privilege('anon', function_oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', function_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'fresh-chain rollback did not restore exposure for %', signature;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.cleanup_expired_sessions()'::regprocedure AND proconfig IS NULL)
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.expire_stale_sessions()'::regprocedure AND proconfig IS NULL) THEN
    RAISE EXCEPTION 'fresh-chain rollback did not restore null search_path definitions';
  END IF;
  RAISE NOTICE 'FRESH-CHAIN ROLLBACK MATRIX PASSED';
END $$;
