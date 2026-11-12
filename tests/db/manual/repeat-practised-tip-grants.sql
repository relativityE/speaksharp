-- Outcome 4 D2: grant and security checks for 20261112010000_repeat_practised_tip.sql on the Supabase database image.
-- Run by tests/db/manual/repeat-practised-tip-supabase-replay.sh after the migration is applied. Read-only catalog
-- queries. The script separately proves the migration only adds to the public schema (no grant, policy or object is
-- changed or removed) and that no client-executable SECURITY DEFINER function appears.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned

CREATE FUNCTION pg_temp.check(ok boolean, label text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
    IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL  %', label; END IF;
    RETURN 'PASS  ' || label;
END $f$;

CREATE TEMP VIEW d2_fns AS
SELECT p.oid, p.oid::regprocedure::text AS sig, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner, p.proacl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE '\_prec\_att\_%';

SELECT pg_temp.check((SELECT count(*) FROM d2_fns) = 7, 'the migration adds exactly seven helper functions');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM d2_fns WHERE has_function_privilege('anon', oid, 'EXECUTE')
                                                      OR has_function_privilege('authenticated', oid, 'EXECUTE')),
    'anon and authenticated cannot execute any of them');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM d2_fns, aclexplode(proacl) a WHERE a.grantee = 0),
    'PUBLIC has no EXECUTE on any of them');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM d2_fns WHERE prosecdef AND NOT ('search_path=public, pg_temp' = ANY (proconfig))),
    'every SECURITY DEFINER helper pins search_path = public, pg_temp');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM d2_fns WHERE owner <> 'postgres'), 'all are owned by postgres');
SELECT pg_temp.check(NOT EXISTS (
        SELECT 1 FROM pg_attribute a
         WHERE a.attrelid = 'public.progress_recommendation_attempts'::regclass AND a.attname IN ('practised_tip', 'tip_session_id')
           AND a.attacl IS NOT NULL),
    'the new columns carry no column-level grants of their own');
SELECT pg_temp.check((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.progress_recommendation_attempts'::regclass)
        AND (SELECT array_agg(polname::text || ':' || polcmd::text ORDER BY polname) FROM pg_policy
              WHERE polrelid = 'public.progress_recommendation_attempts'::regclass) = ARRAY['prec_att_select_own:r'],
    'RLS stays on, with only the existing owner-only SELECT policy');

SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM d2_fns WHERE has_function_privilege('service_role', oid, 'EXECUTE')),
    'service_role cannot execute any of them either (owner-only, like the other internal helpers)');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM d2_fns WHERE proacl IS NULL)
                     AND NOT EXISTS (SELECT 1 FROM d2_fns, aclexplode(proacl) a WHERE pg_get_userbyid(a.grantee) <> 'postgres'),
    'their ACLs grant EXECUTE to postgres (the owner) only');
-- Informational, not pass/fail: the existing internal helpers that are not owner-only. Recorded as they are.
SELECT 'INFO  existing internal SECURITY DEFINER helpers in public (name starts with _) that are not owner-only: '
       || coalesce(string_agg(p.proname || ' ' || p.proacl::text, ', ' ORDER BY p.proname), 'none')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef AND p.proname LIKE '\_%' AND p.proname NOT LIKE '\_prec\_att\_%'
   AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE pg_get_userbyid(a.grantee) <> 'postgres');
SELECT 'D2 GRANT CHECKS PASSED';
