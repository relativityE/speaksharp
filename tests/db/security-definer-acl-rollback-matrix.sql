\set ON_ERROR_STOP on

DO $$
DECLARE signature text;
BEGIN
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
    'public.redeem_promo(text,uuid)',
    'public.purge_derived_content_on_expire()',
    'public.handle_new_user()',
    'public.ensure_trial_profile_for_new_user()'
  ] LOOP
    IF NOT has_function_privilege('anon', signature, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', signature, 'EXECUTE')
       OR NOT has_function_privilege('service_role', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'rollback did not restore four-role exposure for %', signature;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.cleanup_expired_sessions()'::regprocedure AND proconfig IS NULL)
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.expire_stale_sessions()'::regprocedure AND proconfig IS NULL)
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.redeem_promo(text,uuid)'::regprocedure AND proconfig IS NULL) THEN
    RAISE EXCEPTION 'rollback did not restore null search_path definitions';
  END IF;
  RAISE NOTICE 'ROLLBACK MATRIX PASSED';
END $$;
