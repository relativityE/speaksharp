-- #1287 disposable PostgreSQL 15/16/17 matrix.
-- Runs only against the throwaway bootstrap. All IDs are synthetic and output is sanitized.

DO $$
DECLARE
  v_snapshot regprocedure := to_regprocedure(
    'public.apply_stripe_subscription_snapshot(text,text,text,text,boolean,boolean,bigint,uuid,bigint)'
  );
  v_config text;
  v_public_execute boolean;
  v_result jsonb;
  v_count int;
  v_status text;
  v_subscription text;
  v_customer text;
  v_user_a uuid := '00000000-0000-0000-0000-000000001287';
  v_user_b uuid := '00000000-0000-0000-0000-000000001288';
  v_user_c uuid := '00000000-0000-0000-0000-000000001289';
  v_user_d uuid := '00000000-0000-0000-0000-000000001290';
BEGIN
  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'snapshot RPC is absent';
  END IF;

  IF NOT has_function_privilege('service_role', v_snapshot, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lacks snapshot EXECUTE';
  END IF;
  IF has_function_privilege('anon', v_snapshot, 'EXECUTE')
     OR has_function_privilege('authenticated', v_snapshot, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon/authenticated can execute snapshot RPC';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM pg_proc p,
           LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
     WHERE p.oid = v_snapshot::oid
       AND acl.grantee = 0
       AND acl.privilege_type = 'EXECUTE'
  ) INTO v_public_execute;
  IF v_public_execute THEN
    RAISE EXCEPTION 'PUBLIC can execute snapshot RPC';
  END IF;

  SELECT array_to_string(proconfig, ',') INTO v_config FROM pg_proc WHERE oid = v_snapshot::oid;
  IF replace(COALESCE(v_config, ''), ' ', '') <> 'search_path=public,pg_temp' THEN
    RAISE EXCEPTION 'snapshot search_path mismatch';
  END IF;

  IF has_table_privilege('service_role', 'public.stripe_subscription_tombstones', 'SELECT')
     OR has_table_privilege('service_role', 'public.stripe_subscription_tombstones', 'INSERT')
     OR has_table_privilege('anon', 'public.stripe_subscription_tombstones', 'SELECT')
     OR has_table_privilege('authenticated', 'public.stripe_subscription_tombstones', 'SELECT') THEN
    RAISE EXCEPTION 'tombstone table has direct client/service-role access';
  END IF;

  SELECT count(*)::int INTO v_count
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname IN (
     'user_profiles_stripe_subscription_id_unique_1287',
     'user_profiles_stripe_customer_id_unique_1287'
   )
     AND i.indisunique
     AND i.indpred IS NOT NULL;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'expected two partial unique billing-identity indexes';
  END IF;

  INSERT INTO public.user_profiles
    (id, subscription_status, stripe_subscription_id, stripe_customer_id)
  VALUES
    (v_user_a, 'pro', 'sub_matrix_live', 'cus_matrix_live'),
    (v_user_b, 'free', NULL, NULL),
    (v_user_c, 'free', NULL, NULL),
    (v_user_d, 'free', 'sub_missing_customer', NULL);

  -- Already-bound active wrong-price is a deterministic non-grant and preserves exact identity.
  SELECT public.apply_stripe_subscription_snapshot(
    'evt_wrong_price', 'sub_matrix_live', 'cus_matrix_live', 'active', false,
    false, NULL, NULL, 1000
  ) INTO v_result;
  IF v_result->>'success' <> 'true' OR v_result->>'entitlement' <> 'free'
     OR v_result->>'non_grant_reason' <> 'unapproved_price' THEN
    RAISE EXCEPTION 'wrong-price active snapshot did not return structured non-grant';
  END IF;
  SELECT subscription_status, stripe_subscription_id, stripe_customer_id
    INTO v_status, v_subscription, v_customer
    FROM public.user_profiles WHERE id = v_user_a;
  IF v_status <> 'free' OR v_subscription <> 'sub_matrix_live' OR v_customer <> 'cus_matrix_live' THEN
    RAISE EXCEPTION 'wrong-price snapshot changed durable identity or retained Pro';
  END IF;

  -- Approved active restores the already-bound subscription.
  SELECT public.apply_stripe_subscription_snapshot(
    'evt_restore', 'sub_matrix_live', 'cus_matrix_live', 'active', true,
    false, NULL, NULL, 1001
  ) INTO v_result;
  IF v_result->>'entitlement' <> 'pro' THEN
    RAISE EXCEPTION 'approved active snapshot did not grant Pro';
  END IF;

  -- Live customer mismatch fails and cannot replace the stored customer.
  SELECT public.apply_stripe_subscription_snapshot(
    'evt_customer_mismatch', 'sub_matrix_live', 'cus_wrong', 'active', true,
    false, NULL, NULL, 1002
  ) INTO v_result;
  IF v_result->>'success' <> 'false' THEN
    RAISE EXCEPTION 'live customer mismatch was accepted';
  END IF;
  SELECT stripe_customer_id INTO v_customer FROM public.user_profiles WHERE id = v_user_a;
  IF v_customer <> 'cus_matrix_live' THEN
    RAISE EXCEPTION 'live customer mismatch replaced stored identity';
  END IF;

  -- Terminal downgrade works even when price is unapproved, creates authority, then clears live key.
  SELECT public.apply_stripe_subscription_snapshot(
    'evt_terminal', 'sub_matrix_live', 'cus_matrix_live', 'canceled', false,
    false, NULL, NULL, 1003
  ) INTO v_result;
  IF v_result->>'success' <> 'true' OR v_result->>'entitlement' <> 'free' THEN
    RAISE EXCEPTION 'terminal wrong-price snapshot did not revoke access';
  END IF;
  SELECT stripe_subscription_id INTO v_subscription FROM public.user_profiles WHERE id = v_user_a;
  IF v_subscription IS NOT NULL THEN
    RAISE EXCEPTION 'terminal snapshot did not clear live subscription key';
  END IF;
  SELECT count(*)::int INTO v_count
    FROM public.stripe_subscription_tombstones
   WHERE subscription_id = 'sub_matrix_live' AND customer_id = 'cus_matrix_live';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'terminal snapshot did not create exact tombstone';
  END IF;

  -- Exact tombstone is a Free no-op; customer mismatch remains retryable failure.
  SELECT public.apply_stripe_subscription_snapshot(
    'evt_terminal_late', 'sub_matrix_live', 'cus_matrix_live', 'active', true,
    false, NULL, NULL, 1004
  ) INTO v_result;
  IF v_result->>'success' <> 'true' OR v_result->>'entitlement' <> 'free' THEN
    RAISE EXCEPTION 'exact terminal-late snapshot did not converge to Free';
  END IF;
  SELECT public.apply_stripe_subscription_snapshot(
    'evt_terminal_wrong_customer', 'sub_matrix_live', 'cus_wrong', 'active', true,
    false, NULL, NULL, 1005
  ) INTO v_result;
  IF v_result->>'success' <> 'false' THEN
    RAISE EXCEPTION 'tombstone customer mismatch was accepted';
  END IF;

  -- Unknown terminal cannot manufacture a tombstone or retain the processed marker.
  SELECT public.apply_stripe_subscription_snapshot(
    'evt_unknown_terminal', 'sub_unknown_terminal', 'cus_unknown_terminal', 'canceled', false,
    false, NULL, NULL, 1006
  ) INTO v_result;
  IF v_result->>'success' <> 'false' THEN
    RAISE EXCEPTION 'unknown terminal snapshot was accepted';
  END IF;
  SELECT count(*)::int INTO v_count FROM public.stripe_subscription_tombstones
   WHERE subscription_id = 'sub_unknown_terminal';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'unknown terminal snapshot manufactured a tombstone';
  END IF;
  SELECT count(*)::int INTO v_count FROM public.processed_webhook_events
   WHERE event_id = 'evt_unknown_terminal';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'failed unknown terminal retained processed marker';
  END IF;

  -- An unapproved non-active first snapshot cannot claim either unique identity or retain retry state.
  SELECT public.apply_stripe_subscription_snapshot(
    'evt_first_wrong_price_nonactive', 'sub_first_wrong_nonactive', 'cus_first_wrong_nonactive', 'past_due', false,
    false, NULL, v_user_b, 1007
  ) INTO v_result;
  IF v_result->>'success' <> 'false' THEN
    RAISE EXCEPTION 'unapproved non-active first binding was accepted';
  END IF;
  SELECT stripe_subscription_id, stripe_customer_id INTO v_subscription, v_customer
    FROM public.user_profiles WHERE id = v_user_b;
  IF v_subscription IS NOT NULL OR v_customer IS NOT NULL THEN
    RAISE EXCEPTION 'unapproved non-active first binding wrote identity';
  END IF;
  SELECT count(*)::int INTO v_count FROM public.stripe_subscription_tombstones
   WHERE subscription_id = 'sub_first_wrong_nonactive';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'unapproved non-active first binding wrote tombstone';
  END IF;
  SELECT count(*)::int INTO v_count FROM public.processed_webhook_events
   WHERE event_id = 'evt_first_wrong_price_nonactive';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'unapproved non-active first binding retained processed marker';
  END IF;

  -- Matching subscription plus missing stored customer is not exact terminal authority.
  SELECT public.apply_stripe_subscription_snapshot(
    'evt_terminal_missing_customer', 'sub_missing_customer', 'cus_supplied_terminal', 'canceled', false,
    false, NULL, v_user_d, 1008
  ) INTO v_result;
  IF v_result->>'success' <> 'false' THEN
    RAISE EXCEPTION 'terminal snapshot filled a missing stored customer';
  END IF;
  SELECT stripe_subscription_id, stripe_customer_id INTO v_subscription, v_customer
    FROM public.user_profiles WHERE id = v_user_d;
  IF v_subscription <> 'sub_missing_customer' OR v_customer IS NOT NULL THEN
    RAISE EXCEPTION 'failed terminal snapshot changed profile identity';
  END IF;
  SELECT count(*)::int INTO v_count FROM public.stripe_subscription_tombstones
   WHERE subscription_id = 'sub_missing_customer';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'missing-customer terminal snapshot wrote tombstone';
  END IF;
  SELECT count(*)::int INTO v_count FROM public.processed_webhook_events
   WHERE event_id = 'evt_terminal_missing_customer';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'missing-customer terminal snapshot retained processed marker';
  END IF;

  -- First binding requires approved price and exact unused identities.
  SELECT public.apply_stripe_subscription_snapshot(
    'evt_first_wrong_price', 'sub_first_wrong', 'cus_first_wrong', 'active', false,
    false, NULL, v_user_b, 1009
  ) INTO v_result;
  IF v_result->>'success' <> 'false' THEN
    RAISE EXCEPTION 'unapproved first binding was accepted';
  END IF;
  SELECT stripe_subscription_id INTO v_subscription FROM public.user_profiles WHERE id = v_user_b;
  IF v_subscription IS NOT NULL THEN
    RAISE EXCEPTION 'unapproved first binding wrote identity';
  END IF;

  SELECT public.apply_stripe_subscription_snapshot(
    'evt_first', 'sub_first', 'cus_first', 'active', true,
    false, NULL, v_user_b, 1010
  ) INTO v_result;
  IF v_result->>'success' <> 'true' OR v_result->>'entitlement' <> 'pro' THEN
    RAISE EXCEPTION 'approved first binding failed';
  END IF;

  SELECT public.apply_stripe_subscription_snapshot(
    'evt_collision', 'sub_first', 'cus_first', 'active', true,
    false, NULL, v_user_c, 1011
  ) INTO v_result;
  IF v_result->>'success' <> 'false' THEN
    RAISE EXCEPTION 'cross-profile binding collision was accepted';
  END IF;

  -- A duplicate receipt does not suppress a newly hydrated canonical snapshot.
  SELECT public.apply_stripe_subscription_snapshot(
    'evt_duplicate', 'sub_first', 'cus_first', 'past_due', true,
    false, NULL, NULL, 1012
  ) INTO v_result;
  SELECT public.apply_stripe_subscription_snapshot(
    'evt_duplicate', 'sub_first', 'cus_first', 'active', true,
    false, NULL, NULL, 1013
  ) INTO v_result;
  IF v_result->>'success' <> 'true' OR v_result->>'entitlement' <> 'pro'
     OR v_result->>'receipt_preexisting' <> 'true' THEN
    RAISE EXCEPTION 'duplicate event did not apply the newly hydrated active snapshot';
  END IF;
  SELECT subscription_status INTO v_status FROM public.user_profiles WHERE id = v_user_b;
  IF v_status <> 'pro' THEN
    RAISE EXCEPTION 'duplicate active snapshot did not restore Pro';
  END IF;

  -- An identical duplicate is harmless and retains exactly one receipt.
  SELECT public.apply_stripe_subscription_snapshot(
    'evt_identical', 'sub_first', 'cus_first', 'active', true,
    false, NULL, NULL, 1014
  ) INTO v_result;
  SELECT public.apply_stripe_subscription_snapshot(
    'evt_identical', 'sub_first', 'cus_first', 'active', true,
    false, NULL, NULL, 1014
  ) INTO v_result;
  SELECT count(*)::int INTO v_count FROM public.processed_webhook_events
   WHERE event_id = 'evt_identical';
  IF v_result->>'entitlement' <> 'pro' OR v_count <> 1 THEN
    RAISE EXCEPTION 'identical duplicate was not harmless/idempotent';
  END IF;

  -- A pre-existing receipt survives an application failure and identity remains unchanged.
  SELECT public.apply_stripe_subscription_snapshot(
    'evt_receipt_survives', 'sub_first', 'cus_first', 'active', true,
    false, NULL, NULL, 1015
  ) INTO v_result;
  SELECT public.apply_stripe_subscription_snapshot(
    'evt_receipt_survives', 'sub_first', 'cus_wrong', 'active', true,
    false, NULL, NULL, 1016
  ) INTO v_result;
  SELECT count(*)::int INTO v_count FROM public.processed_webhook_events
   WHERE event_id = 'evt_receipt_survives';
  IF v_result->>'success' <> 'false' OR v_count <> 1 THEN
    RAISE EXCEPTION 'failed duplicate removed a pre-existing receipt';
  END IF;

  -- A terminal tombstone remains sticky even when the same event id is retried as active.
  SELECT public.apply_stripe_subscription_snapshot(
    'evt_dup_terminal', 'sub_first', 'cus_first', 'canceled', false,
    false, NULL, NULL, 1017
  ) INTO v_result;
  SELECT public.apply_stripe_subscription_snapshot(
    'evt_dup_terminal', 'sub_first', 'cus_first', 'active', true,
    false, NULL, NULL, 1018
  ) INTO v_result;
  SELECT subscription_status, stripe_subscription_id INTO v_status, v_subscription
    FROM public.user_profiles WHERE id = v_user_b;
  IF v_result->>'entitlement' <> 'free' OR v_status <> 'free' OR v_subscription IS NOT NULL THEN
    RAISE EXCEPTION 'same-event duplicate reactivated a terminal tombstone';
  END IF;

  -- Old six-argument Edge/new-DB compatibility: exact old RPC still executes after #1287.
  SELECT public.process_stripe_webhook_event(
    'evt_legacy', 'checkout.session.completed', 'upgrade_to_pro', v_user_c,
    'sub_legacy', 'cus_legacy'
  ) INTO v_result;
  IF v_result->>'success' <> 'true' THEN
    RAISE EXCEPTION 'old six-argument RPC failed against new DB';
  END IF;
END;
$$;

SELECT 'WEBHOOK SNAPSHOT MATRIX PASSED' AS result;
