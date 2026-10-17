-- Forward-only recovery for a Stripe parameter rejection BEFORE session creation.
-- The service adapter, not a caller, supplies the verified Stripe response.
-- Unknown outcomes never use this transition. Applied117–119 stay immutable.
-- Keep117–119's verified table definitions intact. Receipts are private children
-- of the existing operation, so its existing terminal cleanup cascades here.
CREATE TABLE public.account_checkout_rejections (
  operation_id uuid PRIMARY KEY REFERENCES public.account_checkout_operations(operation_id) ON DELETE CASCADE,
  request_id text NOT NULL UNIQUE CHECK(request_id ~ '^req_[A-Za-z0-9]{1,200}$'),
  code text NOT NULL CHECK(code IN ('parameter_missing','parameter_unknown')),
  param text NOT NULL CHECK(length(param) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE public.account_checkout_rejections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_checkout_rejections FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.reconcile_rejected_account_checkout(
  p_user_id uuid,p_operation_id uuid,p_request_id text,p_code text,p_param text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_subscription text;
BEGIN
  IF p_user_id IS NULL OR p_operation_id IS NULL OR p_request_id IS NULL
    OR p_request_id !~ '^req_[A-Za-z0-9]{1,200}$' OR p_code IS NULL
    OR p_code NOT IN ('parameter_missing','parameter_unknown') OR p_param IS NULL
    OR length(p_param) NOT BETWEEN 1 AND 200 THEN RETURN false; END IF;
  -- Match begin/webhook/closure order: profile row, then billing lock. Recheck
  -- current ownership/state AFTER acquiring these locks, never from stale input.
  SELECT stripe_subscription_id INTO v_subscription FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  IF v_subscription IS NOT NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id)
    OR EXISTS(SELECT 1 FROM public.account_billing_fences WHERE user_id=p_user_id AND phase='closing')
    OR EXISTS(SELECT 1 FROM public.account_closure_attempts WHERE user_id=p_user_id AND phase<>'failed')
    THEN RETURN false; END IF;
  UPDATE public.account_checkout_operations SET phase='settled'
    WHERE user_id=p_user_id AND operation_id=p_operation_id AND phase='issuing'
      AND session_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.account_checkout_rejections WHERE operation_id=p_operation_id);
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.account_checkout_rejections(operation_id,request_id,code,param)
    VALUES(p_operation_id,p_request_id,p_code,p_param);
  -- A repeated/unknown delivery does not authorize another transition. The
  -- adapter requires this ACK plus exact readback and never retries the write.
  RETURN true;
END;
$$;

CREATE FUNCTION public.inspect_rejected_account_checkout(p_user_id uuid,p_operation_id uuid)
RETURNS TABLE(user_id uuid,operation_id uuid,session_id text,phase text,rejection_evidence jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT o.user_id,o.operation_id,o.session_id,o.phase,
    CASE WHEN r.operation_id IS NULL THEN NULL ELSE jsonb_build_object('request_id',r.request_id,'code',r.code,'param',r.param) END
    FROM public.account_checkout_operations o LEFT JOIN public.account_checkout_rejections r USING(operation_id)
    WHERE o.user_id=p_user_id AND o.operation_id=p_operation_id;
$$;
REVOKE ALL ON FUNCTION public.reconcile_rejected_account_checkout(uuid,uuid,text,text,text),
  public.inspect_rejected_account_checkout(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_rejected_account_checkout(uuid,uuid,text,text,text),
  public.inspect_rejected_account_checkout(uuid,uuid) TO service_role;
