-- Disposable source proof only. All fixtures roll back. No provider calls.
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('c5555555-5555-4555-8555-555555555555','pending-proof-a@example.test',now()),
 ('c6666666-6666-4666-8666-666666666666','pending-proof-b@example.test',now());
DO $$ DECLARE signature text; role_name text;
BEGIN
  IF EXISTS(SELECT 1 FROM public.account_billing_coordination WHERE checkout_workers_drained OR evidence_reference IS NOT NULL)
    THEN RAISE EXCEPTION 'pending source enabled legacy destruction'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.account_checkout_snapshot_permits'::regclass)
    THEN RAISE EXCEPTION 'snapshot permits lack RLS'; END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_table_privilege(role_name,'public.account_checkout_snapshot_permits','SELECT,INSERT,UPDATE,DELETE')
      THEN RAISE EXCEPTION 'direct snapshot permit access'; END IF;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY['issue_account_closure_pending_token(uuid,text)',
    'inspect_account_closure_pending(uuid)','begin_account_closure_pending(uuid,text,boolean)',
    'apply_account_checkout_snapshot(uuid,uuid,text,text,text,text,text,boolean,boolean,bigint,bigint)'] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_function_privilege(role_name,'public.'||signature,'EXECUTE') THEN RAISE EXCEPTION 'client pending mutation/private read access'; END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role','public.'||signature,'EXECUTE') THEN RAISE EXCEPTION 'missing service pending RPC'; END IF;
  END LOOP;
  IF has_function_privilege('anon','public.account_closure_pending_status()','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.account_closure_pending_status()','EXECUTE')
    THEN RAISE EXCEPTION 'unsafe owner status ACL'; END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE u uuid:='c5555555-5555-4555-8555-555555555555'; other_user uuid:='c6666666-6666-4666-8666-666666666666';
  op uuid; result jsonb; first_status jsonb;
BEGIN
  PERFORM public.issue_account_closure_pending_token(u,repeat('5',64));
  IF public.inspect_account_closure_pending(u) IS NOT NULL THEN RAISE EXCEPTION 'email created pending'; END IF;
  op:=public.begin_account_checkout(u);
  first_status:=public.begin_account_closure_pending(u,repeat('5',64),true);
  IF first_status->>'phase' IS DISTINCT FROM 'pending' OR first_status->>'checkoutPending' IS DISTINCT FROM '1'
    OR first_status->>'destructiveEnabled' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'busy confirmation missing pending'; END IF;
  IF public.begin_account_closure_pending(u,repeat('5',64),true) IS DISTINCT FROM first_status
    THEN RAISE EXCEPTION 'duplicate pending changed request'; END IF;
  BEGIN
    PERFORM public.begin_account_checkout(u); RAISE EXCEPTION 'pending admitted checkout';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'billing operation pending' THEN RAISE; END IF; END;
  PERFORM public.begin_account_checkout(other_user);
  PERFORM public.record_account_checkout(u,op,'cs_pending_proof');
  IF public.confirm_account_checkout_reuse(u,op,'cs_pending_proof') THEN RAISE EXCEPTION 'pending reused checkout'; END IF;
  result:=public.apply_account_checkout_snapshot(u,op,'cs_pending_proof','evt_pending_proof','sub_pending_proof','cus_pending_proof','active',true);
  IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'admitted snapshot did not settle'; END IF;
  IF public.inspect_account_closure_pending(u)->>'checkoutPending' IS DISTINCT FROM '0'
    THEN RAISE EXCEPTION 'settlement remains pending'; END IF;
  PERFORM public.finish_account_closure_attempt(u,(first_status->>'requestId')::uuid);
  IF public.inspect_account_closure_pending(u)->>'phase' IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'finish reopened pending'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','c5555555-5555-4555-8555-555555555555',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.account_closure_pending_status()->>'phase' IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'owner status missing'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','c6666666-6666-4666-8666-666666666666',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.account_closure_pending_status() IS NOT NULL THEN RAISE EXCEPTION 'other account pending leaked'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.account_checkout_snapshot_permits) THEN RAISE EXCEPTION 'permit residue'; END IF;
  IF EXISTS(SELECT 1 FROM public.account_billing_coordination WHERE checkout_workers_drained OR evidence_reference IS NOT NULL)
    THEN RAISE EXCEPTION 'proof enabled destruction'; END IF;
END $$;
ROLLBACK;
SELECT 'ACCOUNT CLOSURE PENDING INVARIANTS PASSED';
