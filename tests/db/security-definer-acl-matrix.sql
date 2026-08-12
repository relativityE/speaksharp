\set ON_ERROR_STOP on

DO $$
DECLARE
  row record;
  has_public boolean;
BEGIN
  FOR row IN SELECT * FROM (VALUES
    ('public.has_objective_capability()', true, false, 'search_path=public, pg_temp'),
    ('public.objective_start_session_v1(uuid,uuid,uuid,text,text,text)', true, false, 'search_path=public, pg_temp'),
    ('public.objective_finalize_evidence_v1(uuid,jsonb)', true, false, 'search_path=public, pg_temp'),
    ('public.objective_select_action_v1(uuid)', true, false, 'search_path=public, pg_temp'),
    ('public.objective_dispute_action_v1(uuid)', true, false, 'search_path=public, pg_temp'),
    ('public.objective_register_source_v1(uuid)', false, true, 'search_path=public, pg_temp'),
    ('public.acquire_recording_lease(uuid,text,boolean)', true, false, 'search_path=public, pg_temp'),
    ('public.heartbeat_recording_lease(uuid)', true, false, 'search_path=public, pg_temp'),
    ('public.release_recording_lease(uuid)', true, false, 'search_path=public, pg_temp'),
    ('public.update_user_usage(integer)', true, false, 'search_path=public, pg_temp'),
    ('public.cleanup_expired_sessions()', false, false, 'search_path=public, pg_temp'),
    ('public.expire_stale_sessions()', false, false, 'search_path=public, pg_temp'),
    ('public.redeem_promo(text,uuid)', false, false, 'search_path=public, pg_temp'),
    ('public.purge_derived_content_on_expire()', false, false, 'search_path=public, pg_temp'),
    ('public.handle_new_user()', false, false, 'search_path=public, auth, pg_temp'),
    ('public.ensure_trial_profile_for_new_user()', false, false, 'search_path=public, pg_temp')
  ) AS expected(signature, authenticated_exec, service_exec, search_path)
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid = row.signature::regprocedure
        AND EXISTS (
          SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
          WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
        )
    ) INTO has_public;
    IF has_public THEN RAISE EXCEPTION 'PUBLIC still executes %', row.signature; END IF;
    IF has_function_privilege('anon', row.signature, 'EXECUTE') THEN RAISE EXCEPTION 'anon still executes %', row.signature; END IF;
    IF has_function_privilege('authenticated', row.signature, 'EXECUTE') IS DISTINCT FROM row.authenticated_exec THEN
      RAISE EXCEPTION 'authenticated grant mismatch for %', row.signature;
    END IF;
    IF has_function_privilege('service_role', row.signature, 'EXECUTE') IS DISTINCT FROM row.service_exec THEN
      RAISE EXCEPTION 'service_role grant mismatch for %', row.signature;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid = row.signature::regprocedure AND p.proconfig @> ARRAY[row.search_path]
    ) THEN RAISE EXCEPTION 'search_path mismatch for % (expected %)', row.signature, row.search_path; END IF;
  END LOOP;
  RAISE NOTICE 'PASS 1: exact ACL and search_path matrix holds for all 16 exposed functions';
END $$;

SET ROLE anon;
DO $$ BEGIN
  PERFORM public.has_objective_capability();
  RAISE EXCEPTION 'anon unexpectedly executed authenticated RPC';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM public.objective_register_source_v1('10000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'anon unexpectedly executed service RPC';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', false);
SELECT public.has_objective_capability();
SELECT public.objective_start_session_v1(NULL,NULL,NULL,'d','f','i');
SELECT public.objective_finalize_evidence_v1(NULL,'[]');
SELECT public.objective_select_action_v1(NULL);
SELECT public.objective_dispute_action_v1(NULL);
SELECT public.acquire_recording_lease('30000000-0000-4000-8000-000000000001','test',false);
SELECT public.heartbeat_recording_lease('30000000-0000-4000-8000-000000000001');
SELECT public.release_recording_lease('30000000-0000-4000-8000-000000000001');
SELECT public.update_user_usage(1);
RESET ROLE;

SET ROLE service_role;
SELECT public.objective_register_source_v1('40000000-0000-4000-8000-000000000001');
RESET ROLE;

TRUNCATE public.secdef_trigger_audit, public.secdef_trigger_probe;
INSERT INTO public.secdef_trigger_probe(id) VALUES (1);
UPDATE public.secdef_trigger_probe SET touched = true WHERE id = 1;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.secdef_trigger_audit) <> 3 THEN
    RAISE EXCEPTION 'trigger functions did not execute without direct grants';
  END IF;
  RAISE NOTICE 'PASS 2: anon rejected; authenticated/service callers and all three triggers succeed';
END $$;

SELECT 'SECURITY DEFINER ACL MATRIX COMPLETE' AS result;
