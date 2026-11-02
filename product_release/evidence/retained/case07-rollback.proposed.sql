-- REVIEW CANDIDATE ONLY. No Production execution is authorized by this file.
-- Exact inverse of the two selected grants, only while their postimage is intact.
-- Capture/compare all explicit column ACLs and grantors before selecting this rollback.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';
LOCK TABLE public.user_goals IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.user_goals'::regclass
   AND relacl::text='{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}') THEN
   RAISE EXCEPTION 'CASE07_STOP_ROLLBACK_TABLE_ACL_DRIFT';
 END IF;
 IF (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
   WHERE attrelid='public.user_goals'::regclass AND attnum>0 AND NOT attisdropped)
   IS DISTINCT FROM ARRAY['id','user_id','weekly_goal','clarity_goal','created_at','updated_at'] THEN
   RAISE EXCEPTION 'CASE07_STOP_ROLLBACK_COLUMNS_DRIFT';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
   WHERE a.attrelid='public.user_goals'::regclass AND a.attnum>0 AND NOT a.attisdropped
     AND (x.grantee<>(SELECT oid FROM pg_roles WHERE rolname='authenticated')
       OR x.grantor<>(SELECT oid FROM pg_roles WHERE rolname='postgres') OR x.is_grantable
       OR a.attname NOT IN ('id','user_id','weekly_goal','clarity_goal','created_at','updated_at')
       OR x.privilege_type NOT IN ('SELECT','INSERT','UPDATE')
       OR (a.attname IN ('id','created_at','updated_at') AND x.privilege_type<>'SELECT'))) THEN
   RAISE EXCEPTION 'CASE07_STOP_ROLLBACK_COLUMN_ACL_DRIFT';
 END IF;
 IF (SELECT count(*) FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
   WHERE a.attrelid='public.user_goals'::regclass AND a.attnum>0 AND NOT a.attisdropped)<>12 THEN
   RAISE EXCEPTION 'CASE07_STOP_ROLLBACK_COLUMN_SET_DRIFT';
 END IF;
END $$;
REVOKE SELECT (id,user_id,weekly_goal,clarity_goal,created_at,updated_at) ON public.user_goals FROM authenticated;
REVOKE INSERT (user_id,weekly_goal,clarity_goal), UPDATE (user_id,weekly_goal,clarity_goal) ON public.user_goals FROM authenticated;
COMMIT;
