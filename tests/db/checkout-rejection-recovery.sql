-- Disposable schema assertions only. No provider request or production mutation.
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('c3333333-3333-4333-8333-333333333333','checkout-rejection-proof@example.test',now()),
 ('c4444444-4444-4444-8444-444444444444','checkout-other-proof@example.test',now());
DO $$
DECLARE signature text; role_name text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.account_checkout_rejections'::regclass)
    THEN RAISE EXCEPTION 'rejection receipts lack RLS'; END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_table_privilege(role_name,'public.account_checkout_rejections','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'direct rejection receipt access'; END IF;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY['reconcile_rejected_account_checkout(uuid,uuid,text,text,text)',
    'inspect_rejected_account_checkout(uuid,uuid)'] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_function_privilege(role_name,'public.'||signature,'EXECUTE') THEN RAISE EXCEPTION 'client rejection RPC access'; END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role','public.'||signature,'EXECUTE') THEN RAISE EXCEPTION 'missing service rejection RPC access'; END IF;
  END LOOP;
END $$;
SET LOCAL ROLE service_role;
DO $$
DECLARE u uuid:='c3333333-3333-4333-8333-333333333333'; other_user uuid:='c4444444-4444-4444-8444-444444444444';
  op uuid; next_op uuid; snapshot jsonb;
BEGIN
  op:=public.begin_account_checkout(u);
  IF public.reconcile_rejected_account_checkout(other_user,op,'req_proof','parameter_missing','line_items')
    OR public.reconcile_rejected_account_checkout(u,gen_random_uuid(),'req_proof','parameter_missing','line_items')
    OR public.reconcile_rejected_account_checkout(u,op,NULL,'parameter_missing','line_items')
    OR public.reconcile_rejected_account_checkout(u,op,'req_proof','api_error','line_items')
    OR public.reconcile_rejected_account_checkout(u,op,'req_proof','parameter_missing',NULL)
    THEN RAISE EXCEPTION 'invalid rejection transition admitted'; END IF;
  SELECT to_jsonb(t) INTO STRICT snapshot FROM public.inspect_rejected_account_checkout(u,op) t;
  IF snapshot->>'phase'<>'issuing' OR snapshot->'rejection_evidence'<>'null'::jsonb THEN RAISE EXCEPTION 'invalid rejection changed issuing'; END IF;
  IF NOT public.reconcile_rejected_account_checkout(u,op,'req_proof','parameter_missing','line_items') THEN RAISE EXCEPTION 'definitive rejection refused'; END IF;
  SELECT to_jsonb(t) INTO STRICT snapshot FROM public.inspect_rejected_account_checkout(u,op) t;
  IF snapshot->>'phase'<>'settled' OR snapshot->'session_id'<>'null'::jsonb
    OR snapshot->'rejection_evidence'<>jsonb_build_object('request_id','req_proof','code','parameter_missing','param','line_items')
    THEN RAISE EXCEPTION 'rejection readback mismatch'; END IF;
  IF public.reconcile_rejected_account_checkout(u,op,'req_proof','parameter_missing','line_items') THEN RAISE EXCEPTION 'rejection write replayed'; END IF;
  next_op:=public.begin_account_checkout(u);
  IF next_op=op THEN RAISE EXCEPTION 'checkout operation reused'; END IF;
  PERFORM public.record_account_checkout(u,next_op,'cs_rejection_proof');
  IF public.reconcile_rejected_account_checkout(u,next_op,'req_proof','parameter_missing','line_items') THEN RAISE EXCEPTION 'created-session reservation released'; END IF;
  PERFORM public.reconcile_account_checkout_expiry(u,next_op,'cs_rejection_proof');
  IF public.reconcile_rejected_account_checkout(u,next_op,'req_proof','parameter_missing','line_items') THEN RAISE EXCEPTION 'settled reservation changed'; END IF;
END $$;
RESET ROLE;
-- Existing terminal operation cleanup must remove its private proof as well.
DELETE FROM public.account_checkout_operations WHERE user_id IN
 ('c3333333-3333-4333-8333-333333333333','c4444444-4444-4444-8444-444444444444');
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.account_checkout_rejections WHERE request_id='req_proof') THEN RAISE EXCEPTION 'rejection proof residue'; END IF;
END $$;
ROLLBACK;
SELECT 'CHECKOUT REJECTION RECOVERY INVARIANTS PASSED';
