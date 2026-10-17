-- Actual119-schema contract, isolated fixture only; NOT provider/drain truth.
-- Every fixture/temporary enablement is rolled back before the driver postflight.
BEGIN;
SELECT 'CLOSURE_STAGE fixture:start';
INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
VALUES('c1111111-1111-4111-8111-111111111111','closure-enforcement-proof@example.test',now(),'{}','{}');
SET LOCAL ROLE service_role;
DO $$
DECLARE a uuid:='c2222222-2222-4222-8222-222222222222'; created timestamptz:=clock_timestamp()-interval '1 second';
  expires timestamptz:=clock_timestamp()+interval '5 minutes'; record jsonb; validation jsonb;
  context jsonb:=jsonb_build_object('candidateSha',repeat('c',40),'configDigest',repeat('d',64),'migrationDigest',repeat('e',64),
    'projectId','disposable-full-chain','environment','disposable');
BEGIN
  record:=jsonb_build_object('version',1,'candidateSha',context->>'candidateSha','mainSha',repeat('f',40),
    'migrationDigest',context->>'migrationDigest','target',jsonb_build_object('projectId',context->>'projectId','environment','disposable'),
    'deployments','[]'::jsonb,'configDigest',context->>'configDigest',
    'payments',jsonb_build_object('frontendEnabled',false,'backendEnabled',false),'operatorId','disposable-fixture',
    'createdAt',created,'expiresAt',expires,'evidenceDigest',repeat('e',64),'bindingDigest',repeat('b',64),
    'legacyWriters','[]'::jsonb,'inventory','{}'::jsonb);
  validation:=jsonb_build_object('version',1,'validation','OFFLINE_VALID','activationAuthorized',false,
    'bindingDigest',repeat('b',64),'evidenceDigest',repeat('e',64),'quarantined','[]'::jsonb);
  RAISE NOTICE 'CLOSURE_STAGE register:start';
  PERFORM public.record_account_closure_drain_attestation(a,0,record,validation);
  RAISE NOTICE 'CLOSURE_STAGE register:done';
  BEGIN
    RAISE NOTICE 'CLOSURE_STAGE disabled-issuance:start';
    PERFORM public.issue_account_closure_token_with_drain('c1111111-1111-4111-8111-111111111111',repeat('9',64),a,0,repeat('b',64),context);
    RAISE EXCEPTION 'disabled rollout admitted guarded issuance';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'deletion not enabled for this attestation' THEN RAISE; END IF;
    RAISE NOTICE 'CLOSURE_STAGE disabled-issuance:refused';
  END;
END $$;
RESET ROLE;
UPDATE public.account_billing_coordination SET checkout_workers_drained=true,
  evidence_reference='c2222222-2222-4222-8222-222222222222';
SET LOCAL ROLE service_role;
DO $$
DECLARE u uuid:='c1111111-1111-4111-8111-111111111111'; a uuid:='c2222222-2222-4222-8222-222222222222'; request uuid;
  context jsonb:=jsonb_build_object('candidateSha',repeat('c',40),'configDigest',repeat('d',64),'migrationDigest',repeat('e',64),
    'projectId','disposable-full-chain','environment','disposable'); proof jsonb;
BEGIN
  RAISE NOTICE 'CLOSURE_STAGE legacy-issue:start';
  BEGIN PERFORM public.issue_account_closure_token(u,repeat('9',64)); RAISE EXCEPTION 'legacy issue bypass';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'CLOSURE_STAGE legacy-issue:refused';
  RAISE NOTICE 'CLOSURE_STAGE legacy-claim:start';
  BEGIN PERFORM public.claim_account_closure_token(u,repeat('9',64)); RAISE EXCEPTION 'legacy claim bypass';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'CLOSURE_STAGE legacy-claim:refused';
  RAISE NOTICE 'CLOSURE_STAGE legacy-reconcile:start';
  BEGIN PERFORM public.reconcile_expired_account_checkout(u,repeat('9',64),a,'cs_unverified'); RAISE EXCEPTION 'legacy reconcile bypass';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'CLOSURE_STAGE legacy-reconcile:refused';
  RAISE NOTICE 'CLOSURE_STAGE guarded-issuance:start';
  PERFORM public.issue_account_closure_token_with_drain(u,repeat('9',64),a,0,repeat('b',64),context);
  RAISE NOTICE 'CLOSURE_STAGE guarded-issuance:done';
  RAISE NOTICE 'CLOSURE_STAGE claim:start';
  SELECT t.request_id INTO STRICT request FROM public.claim_account_closure_token_with_drain(u,repeat('9',64),a,0,repeat('b',64),context) t;
  RAISE NOTICE 'CLOSURE_STAGE claim:done';
  RAISE NOTICE 'CLOSURE_STAGE claim-replay:start';
  IF EXISTS(SELECT 1 FROM public.claim_account_closure_token_with_drain(u,repeat('9',64),a,0,repeat('b',64),context))
    THEN RAISE EXCEPTION 'guarded claim replayed'; END IF;
  RAISE NOTICE 'CLOSURE_STAGE claim-replay:refused';
  PERFORM public.preserve_account_trial_email(u);
  RAISE NOTICE 'CLOSURE_STAGE auth-unknown:start';
  PERFORM public.record_account_closure_auth_state_with_drain(u,request,'auth_unknown',a,0,repeat('b',64),context);
  PERFORM public.record_account_closure_auth_state_with_drain(u,request,'auth_unknown',a,0,repeat('b',64),context);
  RAISE NOTICE 'CLOSURE_STAGE journal-inspect:start';
  proof:=public.inspect_account_closure_authority(u,request,a,0,repeat('b',64),context);
  RAISE NOTICE 'CLOSURE_STAGE journal-inspect:done';
  IF proof->'attempt'->>'phase'<>'auth_unknown' OR proof->'attempt'->>'requestId'<>request::text
    THEN RAISE EXCEPTION 'durable hold readback mismatch'; END IF;
END $$;
RESET ROLE;
-- SQL simulation of Auth cascade, not a successful Supabase Auth DELETE proof.
SELECT 'CLOSURE_STAGE auth-delete:start';
DELETE FROM auth.users WHERE id='c1111111-1111-4111-8111-111111111111';
SELECT 'CLOSURE_STAGE auth-delete:done';
DO $$
DECLARE u uuid:='c1111111-1111-4111-8111-111111111111'; a uuid:='c2222222-2222-4222-8222-222222222222'; request uuid;
  context jsonb:=jsonb_build_object('candidateSha',repeat('c',40),'configDigest',repeat('d',64),'migrationDigest',repeat('e',64),
    'projectId','disposable-full-chain','environment','disposable'); proof jsonb;
BEGIN
  SELECT request_id INTO STRICT request FROM public.account_closure_attempts WHERE user_id=u AND phase='auth_unknown';
  SET LOCAL ROLE service_role;
  RAISE NOTICE 'CLOSURE_STAGE auth-deleted:start';
  PERFORM public.record_account_closure_auth_state_with_drain(u,request,'auth_deleted',a,0,repeat('b',64),context);
  PERFORM public.record_account_closure_auth_state_with_drain(u,request,'auth_deleted',a,0,repeat('b',64),context);
  RAISE NOTICE 'CLOSURE_STAGE residue:start';
  IF NOT public.verify_account_closure_residue_with_drain(u,request,a,0,repeat('b',64),context)
    THEN RAISE EXCEPTION 'guarded residue readback mismatch'; END IF;
  RAISE NOTICE 'CLOSURE_STAGE completion:ack';
  PERFORM public.record_account_closure_auth_state_with_drain(u,request,'completed',a,0,repeat('b',64),context);
  RAISE NOTICE 'CLOSURE_STAGE completion:ack';
  PERFORM public.record_account_closure_auth_state_with_drain(u,request,'completed',a,0,repeat('b',64),context);
  RAISE NOTICE 'CLOSURE_STAGE journal-inspect:start';
  proof:=public.inspect_account_closure_authority(u,request,a,0,repeat('b',64),context);
  RAISE NOTICE 'CLOSURE_STAGE journal-inspect:done';
  IF proof->'attempt'->>'phase'<>'completed' THEN RAISE EXCEPTION 'completion readback mismatch'; END IF;
END $$;
SELECT 'ACCOUNT CLOSURE ENFORCEMENT FULL-CHAIN INVARIANTS PASSED';
ROLLBACK;
SELECT 'CLOSURE_STAGE fixture:rolled-back';
