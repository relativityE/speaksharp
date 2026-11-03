-- REVIEW CANDIDATE ONLY. No Production execution is authorized by this file.
-- Target: yxlapjuovrsvjswkwnrk/public.user_goals, authenticated role only.
-- Requires independent review, native controls, exact selected executor/window,
-- action-time permission confirmation and applicable backend authority guards.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';
LOCK TABLE public.user_goals IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE names text[];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.user_goals'::regclass
   AND relkind='r' AND relrowsecurity AND NOT relforcerowsecurity
   AND pg_get_userbyid(relowner)='postgres'
   AND relacl::text='{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}') THEN
   RAISE EXCEPTION 'CASE07_STOP_TABLE_ACL_OR_RLS_DRIFT';
 END IF;
 SELECT array_agg(attname::text ORDER BY attnum) INTO names FROM pg_attribute
 WHERE attrelid='public.user_goals'::regclass AND attnum>0 AND NOT attisdropped;
 IF names IS DISTINCT FROM ARRAY['id','user_id','weekly_goal','clarity_goal','created_at','updated_at'] THEN
   RAISE EXCEPTION 'CASE07_STOP_COLUMNS_DRIFT';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.user_goals'::regclass AND attnum>0 AND NOT attisdropped
   AND (attacl IS NOT NULL OR has_column_privilege('authenticated',attrelid,attnum,'SELECT')
     OR has_column_privilege('authenticated',attrelid,attnum,'INSERT') OR has_column_privilege('authenticated',attrelid,attnum,'UPDATE'))) THEN
   RAISE EXCEPTION 'CASE07_STOP_COLUMN_ACL_DRIFT';
 END IF;
 IF NOT has_schema_privilege('authenticated','public','USAGE')
   OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated' AND (rolsuper OR rolbypassrls)) THEN
   RAISE EXCEPTION 'CASE07_STOP_ROLE_OR_SCHEMA_DRIFT';
 END IF;
 IF (SELECT count(*) FROM pg_policy WHERE polrelid='public.user_goals'::regclass)<>3
   OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.user_goals'::regclass AND polpermissive
     AND polroles=ARRAY[0::oid] AND (
       (polcmd='r' AND polname='Users can view own goals' AND regexp_replace(pg_get_expr(polqual,polrelid),'\s','','g')='(auth.uid()=user_id)' AND polwithcheck IS NULL)
       OR (polcmd='a' AND polname='Users can insert own goals' AND polqual IS NULL AND regexp_replace(pg_get_expr(polwithcheck,polrelid),'\s','','g')='(auth.uid()=user_id)')
       OR (polcmd='w' AND polname='Users can update own goals' AND regexp_replace(pg_get_expr(polqual,polrelid),'\s','','g')='(auth.uid()=user_id)' AND polwithcheck IS NULL)
     ))<>3 THEN RAISE EXCEPTION 'CASE07_STOP_POLICY_DRIFT';
 END IF;
END $$;
GRANT SELECT (id,user_id,weekly_goal,clarity_goal,created_at,updated_at) ON public.user_goals TO authenticated;
GRANT INSERT (user_id,weekly_goal,clarity_goal), UPDATE (user_id,weekly_goal,clarity_goal) ON public.user_goals TO authenticated;
-- No application/auth row read or write, role membership, policy, schema/default,
-- service_role/anon change, DELETE/TRUNCATE/TRIGGER or grant option.
COMMIT;
