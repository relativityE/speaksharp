-- Disposable fully migrated Supabase only, invoked by account-closure-full-chain.mjs.
-- No substitute Auth/storage schema, production credentials or provider execution.
-- Fixture coverage below is synthetic input, NOT operational worker/provider evidence.
-- This file proves sequential real-schema compatibility, NOT native concurrent locks.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';

DO $$
DECLARE r record; actor text; privilege text; count_tables integer:=0; count_functions integer:=0;
BEGIN
  IF (SELECT enabled FROM public.account_completion_configuration) IS DISTINCT FROM false
    OR (SELECT checkout_workers_drained FROM public.account_billing_coordination) IS DISTINCT FROM false
    OR EXISTS(SELECT 1 FROM public.account_completion_coverage) THEN
    RAISE EXCEPTION 'proof requires inactive configuration and no operational coverage';
  END IF;
  FOR r IN SELECT c.oid,c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('account_completion_configuration','account_completion_coverage',
      'account_save_obligations','account_completion_executions','account_completion_stages','account_completion_status_capabilities') LOOP
    count_tables:=count_tables+1;
    IF NOT r.relrowsecurity THEN RAISE EXCEPTION 'completion RLS missing: %',r.relname; END IF;
    FOREACH actor IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege(actor,r.oid,privilege) THEN RAISE EXCEPTION 'direct completion privilege: % % %',actor,r.relname,privilege; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF count_tables<>6 THEN RAISE EXCEPTION 'completion table inventory incomplete'; END IF;
  FOR r IN SELECT p.oid,p.proname,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('claim_account_pending_completion_v1','inspect_account_pending_completion_v1',
      'begin_account_completion_stage_v1','finish_account_completion_stage_v1','complete_account_pending_completion_v1',
      'issue_account_completion_status_v1','acknowledge_account_completion_status_v1','read_account_completion_status_v1') LOOP
    count_functions:=count_functions+1;
    IF NOT r.prosecdef OR NOT ('search_path=""'=ANY(coalesce(r.proconfig,ARRAY[]::text[])))
      OR NOT has_function_privilege('service_role',r.oid,'EXECUTE')
      OR has_function_privilege('anon',r.oid,'EXECUTE') OR has_function_privilege('authenticated',r.oid,'EXECUTE') THEN
      RAISE EXCEPTION 'unsafe completion RPC configuration: %',r.proname;
    END IF;
  END LOOP;
  IF count_functions<>8 THEN RAISE EXCEPTION 'completion RPC inventory incomplete'; END IF;
  FOR r IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('_account_save_lease_obligation_v1','_account_save_session_obligation_v1',
      '_account_save_delete_guard_v1','_account_completion_receipt_v1','_account_completion_lock_v1','_account_completion_status_owner_v1') LOOP
    FOREACH actor IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF has_function_privilege(actor,r.oid,'EXECUTE') THEN RAISE EXCEPTION 'private helper exposed: % %',actor,r.proname; END IF;
    END LOOP;
  END LOOP;
END $$;

-- Exercise the real signup trigger chain and genuine Auth/profile/trial identities.
INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES
 ('b9110000-0000-4000-8000-000000000001','completion-chain-save@example.test',now(),'{}','{}'),
 ('b9110000-0000-4000-8000-000000000002','completion-chain-unknown@example.test',now(),'{}','{}'),
 ('b9110000-0000-4000-8000-000000000003','completion-chain-terminal@example.test',now(),'{}','{}');
UPDATE public.user_profiles SET subscription_status='free',stripe_customer_id=NULL
 WHERE id IN ('b9110000-0000-4000-8000-000000000001','b9110000-0000-4000-8000-000000000002','b9110000-0000-4000-8000-000000000003');

DO $$
DECLARE
  a uuid:='b9110000-0000-4000-8000-000000000001';
  b uuid:='b9110000-0000-4000-8000-000000000002';
  c uuid:='b9110000-0000-4000-8000-000000000003';
  lease uuid:='b9120000-0000-4000-8000-000000000001';
  scope text:=repeat('a',64); wrong_scope text:=repeat('f',64);
  req_a uuid; req_b uuid; req_c uuid; exec_b uuid; exec_c uuid; session_a uuid;
  receipt jsonb; issued jsonb; stage_key text; verifier_owner text;
  status_hash text:=repeat('c',64); replacement_hash text:=repeat('d',64);
  heartbeat_profile boolean:=current_setting('closure_proof.heartbeat_profile')::boolean;
BEGIN
  -- A real admitted take is created before pending closure; it must remain saveable.
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  SET LOCAL ROLE authenticated;
  IF public.acquire_recording_lease(lease,'completion-chain-fixture',false)->>'acquired' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'real-schema lease admission refused';
  END IF;
  receipt:=public.create_session_and_update_usage(jsonb_build_object('title','synthetic completion proof','duration',0,'lease_id',lease),'private');
  session_a:=(receipt->'new_session'->>'id')::uuid;
  IF session_a IS NULL THEN RAISE EXCEPTION 'real-schema session creation failed'; END IF;
  IF heartbeat_profile THEN
    receipt:=public.heartbeat_session(session_a,570);
    IF receipt->>'success' IS DISTINCT FROM 'true' OR receipt->>'accepted_seconds' IS DISTINCT FROM '570' THEN
      RAISE EXCEPTION 'U1 pre-cap heartbeat failed';
    END IF;
    receipt:=public.heartbeat_session(session_a,30);
    IF receipt->>'success' IS DISTINCT FROM 'true' OR receipt->>'final_status' IS DISTINCT FROM 'active'
      OR receipt->>'accepted_seconds' IS DISTINCT FROM '30' THEN RAISE EXCEPTION 'U1 cap heartbeat finalized or lost the take'; END IF;
  END IF;
  RESET ROLE;
  SET LOCAL ROLE service_role;
  PERFORM public.issue_account_closure_pending_token(a,repeat('1',64));
  PERFORM public.issue_account_closure_pending_token(b,repeat('2',64));
  PERFORM public.issue_account_closure_pending_token(c,repeat('3',64));
  PERFORM public.begin_account_closure_pending(a,repeat('1',64),true);
  PERFORM public.begin_account_closure_pending(b,repeat('2',64),true);
  PERFORM public.begin_account_closure_pending(c,repeat('3',64),true);
  RESET ROLE;
  SELECT request_id INTO STRICT req_a FROM public.account_closure_attempts WHERE user_id=a AND phase='pending';
  SELECT request_id INTO STRICT req_b FROM public.account_closure_attempts WHERE user_id=b AND phase='pending';
  SELECT request_id INTO STRICT req_c FROM public.account_closure_attempts WHERE user_id=c AND phase='pending';

  SET LOCAL ROLE service_role;
  IF public.claim_account_pending_completion_v1(c,req_c,scope) IS NOT NULL THEN RAISE EXCEPTION 'disabled configuration admitted effects'; END IF;
  RESET ROLE;
  UPDATE public.account_completion_configuration SET enabled=true,scope_digest=scope;
  SET LOCAL ROLE service_role;
  IF public.claim_account_pending_completion_v1(c,req_c,scope)->>'outcome' IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'missing coverage did not hold';
  END IF;
  RESET ROLE;
  INSERT INTO public.account_completion_coverage(user_id,request_id,scope_digest,legacy_producer_evidence,portal_settlement_evidence)
    VALUES(a,req_a,scope,'synthetic fixture only; not legacy drain evidence','synthetic fixture only; not portal settlement evidence'),
          (b,req_b,scope,'synthetic fixture only; not legacy drain evidence','synthetic fixture only; not portal settlement evidence'),
          (c,req_c,scope,'synthetic fixture only; not legacy drain evidence','synthetic fixture only; not portal settlement evidence');
  SET LOCAL ROLE service_role;
  IF public.claim_account_pending_completion_v1(c,req_b,scope) IS NOT NULL
    OR public.claim_account_pending_completion_v1(c,req_c,wrong_scope) IS NOT NULL THEN RAISE EXCEPTION 'wrong request/scope admitted'; END IF;
  IF public.claim_account_pending_completion_v1(a,req_a,scope)->>'outcome' IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'admitted save debt ignored';
  END IF;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  IF heartbeat_profile THEN
    receipt:=public.heartbeat_session(session_a,50);
    IF receipt->>'success' IS DISTINCT FROM 'true' OR receipt->>'accepted_seconds' IS DISTINCT FROM '0'
      OR receipt->>'final_status' IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'pending/U1 cap heartbeat lost take or billed again'; END IF;
  END IF;
  IF public.release_recording_lease(lease)->>'released' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'pending broke admitted Stop'; END IF;
  RESET ROLE;
  IF EXISTS(SELECT 1 FROM public.active_recording_lease WHERE user_id=a)
    OR NOT EXISTS(SELECT 1 FROM public.account_save_obligations WHERE user_id=a AND phase='admitted') THEN
    RAISE EXCEPTION 'lease release erased save obligation';
  END IF;
  SET LOCAL ROLE service_role;
  IF public.claim_account_pending_completion_v1(a,req_a,scope)->>'outcome' IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'lease absence falsely settled save'; END IF;
  RESET ROLE;
  BEGIN
    DELETE FROM auth.users WHERE id=a;
    RAISE EXCEPTION 'Auth deletion bypassed admitted save';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM<>'account admitted save unsettled' THEN RAISE; END IF;
  END;
  SET LOCAL ROLE authenticated;
  -- Keep the original hosted126 casualty as a negative control against the
  -- shipped #1306 trigger. Its failed save must leave the admitted take intact.
  BEGIN
    PERFORM public.complete_session_v2(session_a,'completed',CASE WHEN heartbeat_profile THEN 600 ELSE 30 END,NULL,
      '{"kind":"synthetic-control"}'::jsonb,3,70,6,'{}'::jsonb,'{}'::jsonb,'saved synthetic take');
    RAISE EXCEPTION 'invalid next-action shape bypassed shipped validator';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    IF SQLERRM<>'#1306: next_action_signal must be the strict enum/numeric shape (no free-form recommendation text)' THEN RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT EXISTS(SELECT 1 FROM public.sessions WHERE id=session_a AND status='active' AND next_action_signal IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.account_save_obligations WHERE user_id=a AND session_id=session_a AND phase='admitted') THEN
    RAISE EXCEPTION 'invalid next-action save changed admitted take or settled its obligation';
  END IF;
  SET LOCAL ROLE authenticated;
  receipt:=public.complete_session_v2(session_a,'completed',CASE WHEN heartbeat_profile THEN 600 ELSE 30 END,NULL,
    '{"reasonCode":"ON_TRACK","actionCode":"MAINTAIN","metric":"none","value":0,"comparator":"within_target","templateVersion":"rec_v1"}'::jsonb,
    3,70,6,'{}'::jsonb,'{}'::jsonb,'saved synthetic take');
  IF receipt->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'pending blocked genuine admitted atomic save'; END IF;
  RESET ROLE;
  IF NOT EXISTS(SELECT 1 FROM public.account_save_obligations WHERE user_id=a AND session_id=session_a AND phase='completed') THEN
    RAISE EXCEPTION 'atomic save did not settle its obligation';
  END IF;

  -- B's unknown effect stays unknown on retry, independently of C's positive path.
  SET LOCAL ROLE service_role;
  receipt:=public.claim_account_pending_completion_v1(b,req_b,scope); exec_b:=(receipt->>'executionId')::uuid;
  IF exec_b IS NULL THEN RAISE EXCEPTION 'unrelated account blocked by A save'; END IF;
  IF public.begin_account_completion_stage_v1(b,req_b,exec_b,scope,'retain_trial')->>'phase' IS DISTINCT FROM 'dispatch' THEN RAISE EXCEPTION 'stage did not dispatch once'; END IF;
  IF public.begin_account_completion_stage_v1(b,req_b,exec_b,scope,'retain_trial')->>'phase' IS DISTINCT FROM 'started' THEN RAISE EXCEPTION 'stage redispatched'; END IF;
  PERFORM public.finish_account_completion_stage_v1(b,req_b,exec_b,scope,'retain_trial','unknown');
  IF public.begin_account_completion_stage_v1(b,req_b,exec_b,scope,'retain_trial')->>'phase' IS DISTINCT FROM 'unknown'
    OR public.finish_account_completion_stage_v1(b,req_b,exec_b,scope,'retain_trial','completed')->>'phase' IS DISTINCT FROM 'unknown'
    OR public.complete_account_pending_completion_v1(b,req_b,exec_b,scope) IS NOT NULL THEN RAISE EXCEPTION 'unknown effect replayed or falsely completed'; END IF;
  RESET ROLE;
  UPDATE public.account_completion_configuration SET enabled=false;
  SET LOCAL ROLE service_role;
  IF public.inspect_account_pending_completion_v1(b,req_b,exec_b,scope) IS NOT NULL
    OR public.begin_account_completion_stage_v1(b,req_b,exec_b,scope,'remove_storage') IS NOT NULL
    OR public.finish_account_completion_stage_v1(b,req_b,exec_b,scope,'retain_trial','unknown')->>'phase' IS DISTINCT FROM 'unknown' THEN
    RAISE EXCEPTION 'disabled configuration admitted effects or erased uncertain intent';
  END IF;
  RESET ROLE;
  UPDATE public.account_completion_configuration SET enabled=true;
  SET LOCAL ROLE service_role;
  issued:=public.issue_account_completion_status_v1(c,req_c,scope,status_hash);
  IF issued->>'requestId' IS DISTINCT FROM req_c::text OR public.read_account_completion_status_v1(req_c,status_hash,scope) IS NOT NULL THEN
    RAISE EXCEPTION 'status requires acknowledged exact capability';
  END IF;
  receipt:=public.issue_account_completion_status_v1(c,req_c,scope,replacement_hash);
  IF receipt->>'expiresAt' IS DISTINCT FROM issued->>'expiresAt'
    OR public.acknowledge_account_completion_status_v1(c,req_c,scope,status_hash)
    OR NOT public.acknowledge_account_completion_status_v1(c,req_c,scope,replacement_hash) THEN
    RAISE EXCEPTION 'lost issue/recovery changed expiry or accepted wrong capability';
  END IF;
  receipt:=public.claim_account_pending_completion_v1(c,req_c,scope); exec_c:=(receipt->>'executionId')::uuid;
  IF exec_c IS NULL OR public.inspect_account_pending_completion_v1(c,req_c,exec_b,scope) IS NOT NULL THEN RAISE EXCEPTION 'wrong executor accepted'; END IF;
  RESET ROLE;
  UPDATE public.trial_entitlements SET trial_started_at=now()-interval '60 days',trial_expires_at=now()-interval '30 days'
    WHERE email='completion-chain-terminal@example.test';
  -- Use the actual reviewed function owner; never create a fixture owner or change ACLs on product functions.
  SELECT pg_get_userbyid(proowner) INTO STRICT verifier_owner FROM pg_proc WHERE oid='public.preserve_account_trial_email(uuid)'::regprocedure;
  EXECUTE format('SET LOCAL ROLE %I',verifier_owner);
  PERFORM public.preserve_account_trial_email(c);
  RESET ROLE;
  SET LOCAL ROLE service_role;
  FOREACH stage_key IN ARRAY ARRAY['retain_trial','remove_storage','delete_auth'] LOOP
    IF public.begin_account_completion_stage_v1(c,req_c,exec_c,scope,stage_key)->>'phase' IS DISTINCT FROM 'dispatch'
      OR public.finish_account_completion_stage_v1(c,req_c,exec_c,scope,stage_key,'completed')->>'phase' IS DISTINCT FROM 'completed' THEN
      RAISE EXCEPTION 'positive completion journal failed';
    END IF;
  END LOOP;
  IF public.complete_account_pending_completion_v1(c,req_c,exec_c,scope) IS NOT NULL THEN RAISE EXCEPTION 'journal fabricated Auth absence'; END IF;
  RESET ROLE;
  DELETE FROM auth.users WHERE id=c;
  -- Actual Storage schema, synthetic bucket/object; no Storage API or remote provider.
  INSERT INTO storage.buckets(id,name) VALUES('closure-completion-proof','closure-completion-proof');
  INSERT INTO storage.objects(bucket_id,name) VALUES('closure-completion-proof',c::text||'/residue');
  SET LOCAL ROLE service_role;
  IF public.complete_account_pending_completion_v1(c,req_c,exec_c,scope) IS NOT NULL THEN RAISE EXCEPTION 'storage path residue falsely completed'; END IF;
  RESET ROLE;
  DELETE FROM storage.objects WHERE bucket_id='closure-completion-proof';
  UPDATE public.trial_entitlements SET email='completion-chain-unrelated@example.test' WHERE email='completion-chain-terminal@example.test';
  SET LOCAL ROLE service_role;
  IF public.complete_account_pending_completion_v1(c,req_c,exec_c,scope) IS NOT NULL THEN RAISE EXCEPTION 'missing retained trial falsely completed'; END IF;
  RESET ROLE;
  UPDATE public.trial_entitlements SET email='completion-chain-terminal@example.test' WHERE email='completion-chain-unrelated@example.test';
  CREATE TABLE public.completion_chain_residue_fixture(user_id uuid);
  INSERT INTO public.completion_chain_residue_fixture VALUES(c);
  ALTER TABLE public.completion_chain_residue_fixture ADD FOREIGN KEY(user_id) REFERENCES auth.users(id) NOT VALID;
  SELECT pg_get_userbyid(proowner) INTO STRICT verifier_owner FROM pg_proc WHERE oid='public.verify_account_closure_residue(uuid,text)'::regprocedure;
  EXECUTE format('GRANT SELECT ON public.completion_chain_residue_fixture TO %I',verifier_owner);
  SET LOCAL ROLE service_role;
  BEGIN
    PERFORM public.complete_account_pending_completion_v1(c,req_c,exec_c,scope);
    RAISE EXCEPTION 'unknown Auth FK residue falsely completed';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM<>'account completion residue remains' THEN RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT EXISTS(SELECT 1 FROM public.account_billing_fences WHERE user_id=c AND request_id=req_c AND phase='closing')
    OR NOT EXISTS(SELECT 1 FROM public.account_completion_executions WHERE execution_id=exec_c AND phase='processing') THEN
    RAISE EXCEPTION 'failed residue check lost recoverable ownership';
  END IF;
  DELETE FROM public.completion_chain_residue_fixture;
  SET LOCAL ROLE service_role;
  IF public.complete_account_pending_completion_v1(c,req_c,exec_c,scope)->>'phase' IS DISTINCT FROM 'completed' THEN RAISE EXCEPTION 'clean Auth/trial/storage terminal path failed'; END IF;
  receipt:=public.read_account_completion_status_v1(req_c,replacement_hash,scope);
  IF receipt->>'outcome' IS DISTINCT FROM 'completed' OR receipt->>'accountDeleted' IS DISTINCT FROM 'true'
    OR receipt->>'canRetry' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'post-Auth status lost terminal result'; END IF;
  IF public.issue_account_completion_status_v1(c,req_c,scope,replacement_hash) IS NOT NULL
    OR public.acknowledge_account_completion_status_v1(c,req_c,scope,replacement_hash)
    OR public.claim_account_pending_completion_v1(c,req_c,scope) IS NOT NULL THEN RAISE EXCEPTION 'post-Auth status renewed effect authority'; END IF;
  RESET ROLE;
  UPDATE public.account_completion_status_capabilities SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=c;
  SET LOCAL ROLE service_role;
  IF public.read_account_completion_status_v1(req_c,replacement_hash,scope) IS NOT NULL THEN RAISE EXCEPTION 'expired status remained usable'; END IF;
  RESET ROLE;
  IF EXISTS(SELECT 1 FROM public.account_billing_fences WHERE user_id=c) THEN RAISE EXCEPTION 'terminal fence residue'; END IF;
  INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
    VALUES('b9110000-0000-4000-8000-000000000004','completion-chain-terminal@example.test',now(),'{}','{}');
  IF NOT EXISTS(SELECT 1 FROM public.user_profiles p JOIN public.trial_entitlements t ON t.user_id=p.id
      WHERE p.id='b9110000-0000-4000-8000-000000000004' AND p.trial_expires_at=t.trial_expires_at AND p.trial_expires_at<now()) THEN
    RAISE EXCEPTION 'real signup retrigger granted a new trial after deletion';
  END IF;
END $$;
ROLLBACK;
-- Driver checks disabled config, zero coverage and disabled legacy rollout after rollback.
SELECT 'ACCOUNT COMPLETION REAL-SCHEMA INVARIANTS PASSED';
