BEGIN;

-- Schema-only addition; it must not activate or reuse an old completion scope.
DO $guard$
BEGIN
  PERFORM 1 FROM public.account_completion_configuration
    WHERE singleton AND NOT enabled AND scope_digest IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'completion must remain disabled before settlement apply'; END IF;
END;
$guard$;

CREATE FUNCTION public.settle_account_completion_billing_v1(
  p_user_id uuid,p_request_id uuid,p_execution_id uuid,p_scope_digest text,p_subscriptions jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE billing_customer text; subscription_row jsonb; tombstone_customer text; tombstone_status text;
BEGIN
  -- Preserve profile -> per-account advisory -> configuration/execution order.
  -- The existing helper rechecks actual time after its serialization waits.
  PERFORM 1 FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'completion settlement unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  IF NOT public._account_completion_lock_v1(p_user_id,p_request_id,p_execution_id,p_scope_digest) THEN
    RAISE EXCEPTION 'completion settlement unavailable';
  END IF;
  SELECT e.customer_id INTO billing_customer FROM public.account_completion_executions e
    WHERE e.user_id=p_user_id AND e.request_id=p_request_id AND e.execution_id=p_execution_id
      AND e.scope_digest=p_scope_digest AND e.phase='processing' FOR UPDATE;
  IF billing_customer IS NULL OR btrim(billing_customer)='' THEN
    RAISE EXCEPTION 'completion settlement unavailable';
  END IF;
  -- A controller-issued fresh intent is required, and this transaction consumes
  -- it. A retry of this RPC cannot replay even an idempotent billing mutation.
  PERFORM 1 FROM public.account_completion_stages
    WHERE execution_id=p_execution_id AND key='settle_billing' AND phase='started' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'completion settlement intent unavailable'; END IF;
  IF NOT public._account_completion_lock_v1(p_user_id,p_request_id,p_execution_id,p_scope_digest) THEN
    RAISE EXCEPTION 'completion settlement unavailable';
  END IF;
  -- The legacy implementation stays internal. Customer comes only from this
  -- executor's bound grant; no provider call takes place while SQL locks are held.
  PERFORM public.settle_account_closure_billing(p_user_id,p_request_id,billing_customer,p_subscriptions);
  -- The legacy precheck can precede a uniqueness wait. Re-read and lock each
  -- actual post-conflict row before accepting its customer/terminal evidence.
  -- A foreign row committed while INSERT waited rolls back the entire settlement.
  FOR subscription_row IN SELECT s.value FROM jsonb_array_elements(p_subscriptions) s ORDER BY s.value->>'id' LOOP
    SELECT customer_id,terminal_status INTO tombstone_customer,tombstone_status
      FROM public.stripe_subscription_tombstones WHERE subscription_id=subscription_row->>'id' FOR SHARE;
    IF NOT FOUND OR tombstone_customer IS DISTINCT FROM billing_customer
      OR tombstone_status NOT IN ('canceled','incomplete_expired') THEN
      RAISE EXCEPTION 'completion settlement customer mismatch';
    END IF;
  END LOOP;
  IF NOT public._account_completion_lock_v1(p_user_id,p_request_id,p_execution_id,p_scope_digest) THEN
    RAISE EXCEPTION 'completion settlement authority expired';
  END IF;
  UPDATE public.account_completion_stages SET phase='completed'
    WHERE execution_id=p_execution_id AND key='settle_billing' AND phase='started';
  IF NOT FOUND THEN RAISE EXCEPTION 'completion settlement intent changed'; END IF;
  IF NOT public._account_completion_lock_v1(p_user_id,p_request_id,p_execution_id,p_scope_digest) THEN
    RAISE EXCEPTION 'completion settlement authority expired';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_account_completion_billing_v1(uuid,uuid,uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.settle_account_completion_billing_v1(uuid,uuid,uuid,text,jsonb) TO service_role;
-- Existing base-RPC revocation and table ACLs are deliberately unchanged.
COMMIT;
