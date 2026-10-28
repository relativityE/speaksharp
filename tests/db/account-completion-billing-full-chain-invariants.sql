-- Disposable fully migrated Supabase only. Sequential compatibility, not a race proof.
-- All identities and coverage below are synthetic and the transaction rolls back.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';

DO $$
DECLARE signature regprocedure:='public.settle_account_completion_billing_v1(uuid,uuid,uuid,text,jsonb)'::regprocedure;
BEGIN
  IF (SELECT enabled FROM public.account_completion_configuration) IS DISTINCT FROM false
    OR (SELECT scope_digest FROM public.account_completion_configuration) IS NOT NULL THEN
    RAISE EXCEPTION 'settlement proof requires disabled unbound configuration';
  END IF;
  IF NOT (SELECT prosecdef AND 'search_path=""'=ANY(coalesce(proconfig,ARRAY[]::text[])) FROM pg_proc WHERE oid=signature)
    OR NOT has_function_privilege('service_role',signature,'EXECUTE')
    OR has_function_privilege('anon',signature,'EXECUTE')
    OR has_function_privilege('authenticated',signature,'EXECUTE')
    OR EXISTS(SELECT 1 FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=signature AND a.grantee=0 AND a.privilege_type='EXECUTE')
    OR has_function_privilege('service_role','public.settle_account_closure_billing(uuid,uuid,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'settlement RPC or legacy revocation ACL mismatch';
  END IF;
END $$;

-- Use the real Auth/signup trigger path, never a replacement Auth/profile schema.
INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
  VALUES('b9190000-0000-4000-8000-000000000001','settlement-chain@example.test',now(),'{}','{}');
UPDATE public.user_profiles SET subscription_status='pro',stripe_customer_id='cus_settlement_chain',
  stripe_subscription_id='sub_settlement_chain' WHERE id='b9190000-0000-4000-8000-000000000001';

DO $$
DECLARE actor uuid:='b9190000-0000-4000-8000-000000000001'; v_request_id uuid; v_execution_id uuid;
  scope text:=repeat('e',64); execution_grant jsonb; receipt jsonb;
  terminal jsonb:='[{"id":"sub_settlement_chain","status":"canceled"}]';
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM public.issue_account_closure_pending_token(actor,repeat('9',64));
  PERFORM public.begin_account_closure_pending(actor,repeat('9',64),true);
  RESET ROLE;
  SELECT a.request_id INTO STRICT v_request_id FROM public.account_closure_attempts a
    WHERE a.user_id=actor AND a.phase='pending';
  SET LOCAL ROLE service_role;
  IF public.claim_account_pending_completion_v1(actor,v_request_id,scope) IS NOT NULL THEN
    RAISE EXCEPTION 'disabled completion admitted a grant';
  END IF;
  RESET ROLE;
  UPDATE public.account_completion_configuration SET enabled=true,scope_digest=scope;
  INSERT INTO public.account_completion_coverage(user_id,request_id,scope_digest,legacy_producer_evidence,portal_settlement_evidence)
    VALUES(actor,v_request_id,scope,'synthetic only; not worker drain evidence','synthetic only; not portal evidence');
  SET LOCAL ROLE service_role;
  IF public.issue_account_completion_status_v1(actor,v_request_id,scope,repeat('8',64)) IS NULL
    OR public.acknowledge_account_completion_status_v1(actor,v_request_id,scope,repeat('8',64)) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'real-schema status acknowledgment failed';
  END IF;
  execution_grant:=public.claim_account_pending_completion_v1(actor,v_request_id,scope);
  v_execution_id:=(execution_grant->>'executionId')::uuid;
  IF v_execution_id IS NULL OR execution_grant->'proof'->>'customerId' IS DISTINCT FROM 'cus_settlement_chain' THEN
    RAISE EXCEPTION 'real-schema paid execution grant failed';
  END IF;
  receipt:=public.begin_account_completion_stage_v1(actor,v_request_id,v_execution_id,scope,'settle_billing');
  IF receipt->>'phase' IS DISTINCT FROM 'dispatch' THEN RAISE EXCEPTION 'settlement intent did not dispatch'; END IF;
  BEGIN
    PERFORM public.settle_account_completion_billing_v1(actor,v_request_id,v_execution_id,repeat('f',64),terminal);
    RAISE EXCEPTION 'wrong scope accepted' USING ERRCODE='XX000';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM<>'completion settlement unavailable' THEN RAISE; END IF;
  END;
  RESET ROLE;
  INSERT INTO public.stripe_subscription_tombstones(subscription_id,customer_id,terminal_status,event_id)
    VALUES('sub_settlement_foreign','cus_settlement_foreign','canceled','synthetic-real-chain');
  SET LOCAL ROLE service_role;
  BEGIN
    PERFORM public.settle_account_completion_billing_v1(actor,v_request_id,v_execution_id,scope,
      terminal||'[{"id":"sub_settlement_foreign","status":"canceled"}]'::jsonb);
    RAISE EXCEPTION 'foreign customer accepted' USING ERRCODE='XX000';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM NOT IN ('terminal identity conflict','completion settlement customer mismatch') THEN RAISE; END IF;
  END;
  RESET ROLE;
  IF (SELECT subscription_status FROM public.user_profiles WHERE id=actor) IS DISTINCT FROM 'pro'
    OR EXISTS(SELECT 1 FROM public.stripe_subscription_tombstones WHERE subscription_id='sub_settlement_chain')
    OR (SELECT phase FROM public.account_completion_stages s WHERE s.execution_id=v_execution_id AND s.key='settle_billing') IS DISTINCT FROM 'started' THEN
    RAISE EXCEPTION 'refused settlement retained partial effects';
  END IF;
  SET LOCAL ROLE service_role;
  IF public.settle_account_completion_billing_v1(actor,v_request_id,v_execution_id,scope,terminal) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'real-schema paid settlement failed';
  END IF;
  receipt:=public.finish_account_completion_stage_v1(actor,v_request_id,v_execution_id,scope,'settle_billing','completed');
  IF receipt->>'phase' IS DISTINCT FROM 'completed' THEN RAISE EXCEPTION 'completed stage receipt missing'; END IF;
  BEGIN
    PERFORM public.settle_account_completion_billing_v1(actor,v_request_id,v_execution_id,scope,terminal);
    RAISE EXCEPTION 'settlement replay accepted' USING ERRCODE='XX000';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM<>'completion settlement intent unavailable' THEN RAISE; END IF;
  END;
  RESET ROLE;
  IF (SELECT subscription_status FROM public.user_profiles WHERE id=actor) IS DISTINCT FROM 'free'
    OR (SELECT stripe_subscription_id FROM public.user_profiles WHERE id=actor) IS NOT NULL
    OR (SELECT customer_id FROM public.stripe_subscription_tombstones WHERE subscription_id='sub_settlement_chain') IS DISTINCT FROM 'cus_settlement_chain'
    OR (SELECT phase FROM public.account_completion_stages s WHERE s.execution_id=v_execution_id AND s.key='settle_billing') IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'real-schema settlement result mismatch';
  END IF;
END $$;
ROLLBACK;

DO $$
BEGIN
  IF (SELECT enabled FROM public.account_completion_configuration) IS DISTINCT FROM false
    OR (SELECT scope_digest FROM public.account_completion_configuration) IS NOT NULL
    OR EXISTS(SELECT 1 FROM auth.users WHERE id='b9190000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'settlement oracle did not preserve disabled configuration and fixture rollback';
  END IF;
END $$;
SELECT 'ACCOUNT COMPLETION BILLING REAL-SCHEMA INVARIANTS PASSED';
