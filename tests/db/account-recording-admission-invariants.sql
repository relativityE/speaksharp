-- Owned disposable proof; every synthetic row rolls back. No provider calls.
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('b8010000-0000-4000-8000-000000000001','admission-proof-a@example.test',now()),
 ('b8010000-0000-4000-8000-000000000002','admission-proof-b@example.test',now());
DO $$ DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(role_name,'public._ss_acquire_recording_lease_1476(uuid,text,boolean)','EXECUTE')
      THEN RAISE EXCEPTION 'private recording helper exposed'; END IF;
  END LOOP;
  IF has_function_privilege('anon','public.acquire_recording_lease(uuid,text,boolean)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.acquire_recording_lease(uuid,text,boolean)','EXECUTE')
    THEN RAISE EXCEPTION 'recording wrapper ACL invalid'; END IF;
  IF has_table_privilege('authenticated','public.active_recording_lease','INSERT,UPDATE,DELETE,TRUNCATE')
    THEN RAISE EXCEPTION 'client can bypass recording RPC'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','b8010000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.acquire_recording_lease('b8020000-0000-4000-8000-000000000001')->>'acquired' IS DISTINCT FROM 'true'
    THEN RAISE EXCEPTION 'open account admission refused'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT public.issue_account_closure_pending_token('b8010000-0000-4000-8000-000000000001',repeat('a',64));
SELECT public.begin_account_closure_pending('b8010000-0000-4000-8000-000000000001',repeat('a',64),true);
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.acquire_recording_lease('b8020000-0000-4000-8000-000000000002','forced',true)->>'reason' IS DISTINCT FROM 'account_closure_pending'
    THEN RAISE EXCEPTION 'pending admitted recording'; END IF;
  IF public.heartbeat_recording_lease('b8020000-0000-4000-8000-000000000001')->>'valid' IS DISTINCT FROM 'true'
    THEN RAISE EXCEPTION 'accepted lease heartbeat broken'; END IF;
  IF public.release_recording_lease('b8020000-0000-4000-8000-000000000001')->>'released' IS DISTINCT FROM 'true'
    THEN RAISE EXCEPTION 'accepted lease Stop broken'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','b8010000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.acquire_recording_lease('b8020000-0000-4000-8000-000000000003')->>'acquired' IS DISTINCT FROM 'true'
    THEN RAISE EXCEPTION 'unrelated account blocked'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.account_billing_coordination WHERE checkout_workers_drained OR evidence_reference IS NOT NULL)
    THEN RAISE EXCEPTION 'admission proof enabled destruction'; END IF;
END $$;
ROLLBACK;
SELECT 'ACCOUNT RECORDING ADMISSION INVARIANTS PASSED';
