-- Casualty matrix for 20260928120000_focus_points_trial_capability.sql. Run as the superuser AFTER the bootstrap and the
-- migration chain. Every case is called through the `authenticated` (or `anon` / `service_role`) role with its own JWT
-- subject, exactly as PostgREST calls it. Prints one PASS line per case; raises (non-zero exit under ON_ERROR_STOP) on any FAIL.
DO $matrix$
DECLARE
  cases CONSTANT jsonb := '[
    {"uid": "a0000000-0000-4000-8000-000000000001", "want": true,  "name": "active trial (grant marker, unexpired window) is capable"},
    {"uid": "a0000000-0000-4000-8000-000000000002", "want": false, "name": "expired trial is refused"},
    {"uid": "a0000000-0000-4000-8000-000000000003", "want": false, "name": "a window without the immutable grant marker is refused (canonical #1282 rule)"},
    {"uid": "a0000000-0000-4000-8000-000000000004", "want": false, "name": "free without a trial is refused"},
    {"uid": "a0000000-0000-4000-8000-000000000005", "want": true,  "name": "paid Pro is capable"},
    {"uid": "a0000000-0000-4000-8000-000000000006", "want": true,  "name": "comped/QA Pro stays capable (unchanged)"},
    {"uid": "a0000000-0000-4000-8000-000000000007", "want": true,  "name": "explicit grant is capable (unchanged)"},
    {"uid": "a0000000-0000-4000-8000-000000000008", "want": false, "name": "another account''s grant or trial never leaks to this caller"},
    {"uid": "",                                     "want": false, "name": "no JWT subject is refused"}
  ]'::jsonb;
  c jsonb;
  got boolean;
  fails text[] := '{}';
BEGIN
  FOR c IN SELECT * FROM jsonb_array_elements(cases) LOOP
    PERFORM set_config('request.jwt.claim.sub', c->>'uid', true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE 'SELECT public.has_objective_capability()' INTO got;
    EXECUTE 'RESET ROLE';
    IF got IS DISTINCT FROM (c->>'want')::boolean THEN
      fails := fails || format('%s (want %s, got %s)', c->>'name', c->>'want', got);
    ELSE
      RAISE NOTICE 'PASS %', c->>'name';
    END IF;
  END LOOP;

  -- anon and service_role cannot execute it at all (authenticated-only ACL, 20260811143000 shape).
  FOREACH c IN ARRAY ARRAY['"anon"'::jsonb, '"service_role"'::jsonb] LOOP
    BEGIN
      PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
      EXECUTE format('SET LOCAL ROLE %I', c #>> '{}');
      EXECUTE 'SELECT public.has_objective_capability()' INTO got;
      EXECUTE 'RESET ROLE';
      fails := fails || format('%s executed has_objective_capability()', c #>> '{}');
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS % is denied EXECUTE', c #>> '{}';
    END;
  END LOOP;

  -- Definition shape: SECURITY DEFINER, fixed search_path, STABLE, EXECUTE for authenticated only (never PUBLIC).
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.has_objective_capability()'::regprocedure) THEN
    fails := fails || 'not SECURITY DEFINER'::text;
  END IF;
  IF (SELECT p.proconfig FROM pg_proc p WHERE p.oid = 'public.has_objective_capability()'::regprocedure) IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
    fails := fails || 'search_path is not pinned to public, pg_temp'::text;
  END IF;
  IF (SELECT p.provolatile FROM pg_proc p WHERE p.oid = 'public.has_objective_capability()'::regprocedure) <> 's' THEN
    fails := fails || 'not STABLE (the trial window must be evaluated per call)'::text;
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.has_objective_capability()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.has_objective_capability()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.has_objective_capability()', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                WHERE p.oid = 'public.has_objective_capability()'::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    fails := fails || 'EXECUTE ACL is not authenticated-only'::text;
  ELSE
    RAISE NOTICE 'PASS SECURITY DEFINER, fixed search_path, STABLE, authenticated-only EXECUTE';
  END IF;

  IF cardinality(fails) > 0 THEN
    RAISE EXCEPTION 'FAIL focus-points trial capability: %', array_to_string(fails, '; ');
  END IF;
END
$matrix$;
