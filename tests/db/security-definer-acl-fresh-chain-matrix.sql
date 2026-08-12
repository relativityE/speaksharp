\set ON_ERROR_STOP on

DO $$
DECLARE
  row record;
  function_oid oid;
  has_public boolean;
BEGIN
  IF to_regprocedure('public.redeem_promo(text,uuid)') IS NOT NULL
     OR to_regprocedure('public.handle_new_user()') IS NOT NULL THEN
    RAISE EXCEPTION 'hosted-only function unexpectedly exists in fresh-chain proof';
  END IF;

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
    ('public.purge_derived_content_on_expire()', false, false, 'search_path=public, pg_temp'),
    ('public.ensure_trial_profile_for_new_user()', false, false, 'search_path=public, pg_temp')
  ) AS expected(signature, authenticated_exec, service_exec, search_path)
  LOOP
    function_oid := to_regprocedure(row.signature);
    IF function_oid IS NULL THEN RAISE EXCEPTION 'repository-owned function missing: %', row.signature; END IF;

    SELECT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid = function_oid
        AND EXISTS (
          SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
          WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
        )
    ) INTO has_public;
    IF has_public THEN RAISE EXCEPTION 'PUBLIC still executes %', row.signature; END IF;
    IF has_function_privilege('anon', function_oid, 'EXECUTE') THEN RAISE EXCEPTION 'anon still executes %', row.signature; END IF;
    IF has_function_privilege('authenticated', function_oid, 'EXECUTE') IS DISTINCT FROM row.authenticated_exec THEN
      RAISE EXCEPTION 'authenticated grant mismatch for %', row.signature;
    END IF;
    IF has_function_privilege('service_role', function_oid, 'EXECUTE') IS DISTINCT FROM row.service_exec THEN
      RAISE EXCEPTION 'service_role grant mismatch for %', row.signature;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid = function_oid AND p.proconfig @> ARRAY[row.search_path]
    ) THEN RAISE EXCEPTION 'search_path mismatch for % (expected %)', row.signature, row.search_path; END IF;
  END LOOP;
  RAISE NOTICE 'FRESH-CHAIN PASS 1: all 14 repository-owned functions are hardened';
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
  IF (SELECT count(*) FROM public.secdef_trigger_audit) <> 2 THEN
    RAISE EXCEPTION 'repository-owned trigger functions did not execute without direct grants';
  END IF;
  RAISE NOTICE 'FRESH-CHAIN PASS 2: callers and two repository-owned triggers succeed';
END $$;

SELECT 'FRESH-CHAIN SECURITY DEFINER ACL MATRIX COMPLETE' AS result;
