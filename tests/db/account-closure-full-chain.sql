-- Run only against the driver's disposable, fully migrated Supabase database.
-- All fixtures and the temporary rollout gate are rolled back.
BEGIN;
DO $$
DECLARE r record; actor text;
BEGIN
  IF (SELECT checkout_workers_drained FROM public.account_billing_coordination) THEN
    RAISE EXCEPTION 'rollout gate unexpectedly enabled';
  END IF;
  FOR r IN SELECT c.oid, c.relname, c.relrowsecurity FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN
      ('account_closure_tokens','account_closure_attempts','account_billing_fences',
       'account_checkout_operations','account_billing_coordination','account_closure_billing_permits') LOOP
    IF NOT r.relrowsecurity THEN RAISE EXCEPTION 'RLS absent: %',r.relname; END IF;
    FOREACH actor IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF has_table_privilege(actor,r.oid,'SELECT,INSERT,UPDATE,DELETE') THEN
        RAISE EXCEPTION 'direct table access: % %',actor,r.relname;
      END IF;
    END LOOP;
  END LOOP;
  FOR r IN SELECT p.oid,p.proname,p.prosecdef,p.proconfig FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('begin_account_checkout','inspect_account_checkout','confirm_account_checkout_reuse',
       'reconcile_account_checkout_expiry','record_account_checkout','settle_account_checkout',
       'inspect_account_closure_checkouts','reconcile_expired_account_checkout',
       'issue_account_closure_token','revoke_account_closure_token','claim_account_closure_token',
       'finish_account_closure_attempt','record_account_closure_auth_state',
       'preserve_account_trial_email','settle_account_closure_billing',
       'verify_account_closure_residue','list_account_closure_storage') LOOP
    IF NOT r.prosecdef OR NOT ('search_path=""'=ANY(r.proconfig)) THEN
      RAISE EXCEPTION 'unsafe function configuration: %',r.proname;
    END IF;
    IF NOT has_function_privilege('service_role',r.oid,'EXECUTE') OR
      has_function_privilege('anon',r.oid,'EXECUTE') OR
      has_function_privilege('authenticated',r.oid,'EXECUTE') THEN
      RAISE EXCEPTION 'unsafe function ACL: %',r.proname;
    END IF;
  END LOOP;
END $$;

-- Auth's actual schema and application signup triggers, not a substitute table.
INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
VALUES ('11111111-1111-4111-8111-111111111111','closure-proof@example.test',now(),'{}','{}');
SET LOCAL ROLE service_role;
SELECT * FROM public.issue_account_closure_token(
  '11111111-1111-4111-8111-111111111111',repeat('a',64));
DO $$
BEGIN
  BEGIN
    PERFORM public.claim_account_closure_token('11111111-1111-4111-8111-111111111111',repeat('a',64));
    RAISE EXCEPTION 'disabled rollout unexpectedly admitted closure';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'checkout reconciliation required' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
UPDATE public.account_billing_coordination SET checkout_workers_drained=true,
  evidence_reference='disposable-full-chain-fixture-only';

SET LOCAL ROLE service_role;
DO $$
DECLARE u uuid := '11111111-1111-4111-8111-111111111111'; op uuid; request uuid; count_rows int;
BEGIN
  op := public.begin_account_checkout(u);
  PERFORM public.record_account_checkout(u,op,'cs_disposable');
  IF NOT public.confirm_account_checkout_reuse(u,op,'cs_disposable') THEN
    RAISE EXCEPTION 'normal checkout retry rejected';
  END IF;
  BEGIN
    PERFORM public.claim_account_closure_token(u,repeat('a',64));
    RAISE EXCEPTION 'open checkout escaped closure fence';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'checkout reconciliation required' THEN RAISE; END IF;
  END;
  PERFORM public.reconcile_account_checkout_expiry(u,op,'cs_disposable');
  SELECT request_id INTO STRICT request FROM public.claim_account_closure_token(u,repeat('a',64));
  SELECT count(*) INTO count_rows FROM public.claim_account_closure_token(u,repeat('a',64));
  IF count_rows <> 0 THEN RAISE EXCEPTION 'consumed token replayed'; END IF;
  BEGIN
    PERFORM public.begin_account_checkout(u);
    RAISE EXCEPTION 'closure allowed new checkout';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'billing operation pending' THEN RAISE; END IF;
  END;
  PERFORM public.preserve_account_trial_email(u);
  PERFORM public.record_account_closure_auth_state(u,request,'auth_unknown');
  PERFORM public.finish_account_closure_attempt(u,request);
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT phase FROM public.account_closure_attempts
      WHERE user_id='11111111-1111-4111-8111-111111111111') <> 'auth_unknown' THEN
    RAISE EXCEPTION 'uncertain deletion released its durable hold';
  END IF;
END $$;

UPDATE public.trial_entitlements SET trial_started_at=now()-interval '60 days',
  trial_expires_at=now()-interval '30 days' WHERE email='closure-proof@example.test';
DELETE FROM auth.users WHERE id='11111111-1111-4111-8111-111111111111';
SET LOCAL ROLE service_role;
DO $$ BEGIN
  IF NOT public.verify_account_closure_residue(
    '11111111-1111-4111-8111-111111111111','closure-proof@example.test') THEN
    RAISE EXCEPTION 'auth cascade or retained-email residue mismatch';
  END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.account_closure_attempts
    WHERE user_id='11111111-1111-4111-8111-111111111111' AND phase='auth_unknown') THEN
    RAISE EXCEPTION 'auth cascade erased reconciliation evidence';
  END IF;
END $$;
INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
VALUES ('22222222-2222-4222-8222-222222222222','closure-proof@example.test',now(),'{}','{}');
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.user_profiles p JOIN public.trial_entitlements t
      ON t.user_id=p.id WHERE p.id='22222222-2222-4222-8222-222222222222'
      AND p.trial_expires_at=t.trial_expires_at AND p.trial_expires_at<now()) THEN
    RAISE EXCEPTION 'recreated account obtained another trial';
  END IF;
END $$;
ROLLBACK;
SELECT 'ACCOUNT CLOSURE FULL-CHAIN INVARIANTS PASSED';
