-- Inactive backend primitive, not destructive activation. Start/coaching/portal
-- settlement and the reviewed customer UX must integrate before deletion can run.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.account_billing_coordination WHERE singleton
    AND NOT checkout_workers_drained AND evidence_reference IS NULL FOR UPDATE)
    THEN RAISE EXCEPTION 'deletion must remain disabled before pending apply'; END IF;
END $$;

ALTER TABLE public.account_closure_attempts DROP CONSTRAINT account_closure_attempts_phase_check;
ALTER TABLE public.account_closure_attempts ADD CONSTRAINT account_closure_attempts_phase_check
  CHECK(phase IN ('pending','processing','auth_unknown','auth_deleted','completed','failed'));
ALTER TABLE public.account_closure_attempts ADD CONSTRAINT account_closure_pending_no_destructive_authority
  CHECK(phase<>'pending' OR (drain_attestation_id IS NULL AND drain_generation IS NULL
    AND drain_binding_digest IS NULL AND drain_context IS NULL));
ALTER TABLE public.account_billing_fences DROP CONSTRAINT account_billing_fences_phase_check;
ALTER TABLE public.account_billing_fences ADD CONSTRAINT account_billing_fences_phase_check
  CHECK(phase IN ('open','pending','closing'));
ALTER TABLE public.account_checkout_operations
  ADD COLUMN closure_request_id uuid,
  ADD COLUMN completed_customer_id text,
  ADD COLUMN completed_subscription_id text;

-- Only the canonical completion wrapper can create a transaction-local permit.
CREATE TABLE public.account_checkout_snapshot_permits (
  user_id uuid PRIMARY KEY, operation_id uuid NOT NULL, request_id uuid NOT NULL,
  customer_id text NOT NULL, subscription_id text NOT NULL, transaction_id bigint NOT NULL
);
ALTER TABLE public.account_checkout_snapshot_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_checkout_snapshot_permits FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.issue_account_closure_pending_token(p_user_id uuid,p_token_hash text)
RETURNS TABLE(request_id uuid,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM 1 FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account profile unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  RETURN QUERY SELECT * FROM public.issue_account_closure_token(p_user_id,p_token_hash);
END;
$$;

CREATE FUNCTION public.inspect_account_closure_pending(p_user_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('requestId',a.request_id,'phase','pending','destructiveEnabled',false,
    'checkoutPending',(SELECT count(*) FROM public.account_checkout_operations o
      WHERE o.user_id=a.user_id AND o.phase<>'settled'))
  FROM public.account_closure_attempts a JOIN public.account_billing_fences f
    ON f.user_id=a.user_id AND f.request_id=a.request_id AND f.phase='pending'
  WHERE a.user_id=p_user_id AND a.phase='pending';
$$;

CREATE FUNCTION public.account_closure_pending_status()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT public.inspect_account_closure_pending(auth.uid());
$$;

CREATE FUNCTION public.begin_account_closure_pending(p_user_id uuid,p_token_hash text,p_confirm_irreversible boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.account_closure_tokens; a public.account_closure_attempts;
BEGIN
  IF p_confirm_irreversible IS DISTINCT FROM true THEN RAISE EXCEPTION 'explicit confirmation required'; END IF;
  PERFORM 1 FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  SELECT x.* INTO t FROM public.account_closure_tokens x JOIN auth.users u ON u.id=x.user_id
    WHERE x.user_id=p_user_id AND x.token_hash=p_token_hash
      AND u.email_confirmed_at IS NOT NULL AND lower(btrim(u.email))=x.email_normalized FOR UPDATE OF x;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO a FROM public.account_closure_attempts WHERE user_id=p_user_id FOR UPDATE;
  -- A duplicate can ACK this exact consumed request, never consume again or
  -- adopt another token. Authenticated status recovery needs no token at all.
  IF a.phase='pending' AND a.request_id=t.request_id AND t.phase='processing' AND t.consumed_at IS NOT NULL
    THEN RETURN public.inspect_account_closure_pending(p_user_id); END IF;
  IF (a.user_id IS NOT NULL AND a.phase<>'failed') OR t.phase<>'issued' OR t.consumed_at IS NOT NULL
    OR t.expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
  INSERT INTO public.account_billing_fences(user_id,phase,request_id) VALUES(p_user_id,'pending',t.request_id)
    ON CONFLICT(user_id) DO UPDATE SET phase='pending',request_id=EXCLUDED.request_id;
  INSERT INTO public.account_closure_attempts(user_id,request_id,claimed_email,phase)
    VALUES(p_user_id,t.request_id,t.email_normalized,'pending') ON CONFLICT(user_id) DO UPDATE
    SET request_id=EXCLUDED.request_id,claimed_email=EXCLUDED.claimed_email,phase='pending',updated_at=clock_timestamp(),
      drain_attestation_id=NULL,drain_generation=NULL,drain_binding_digest=NULL,drain_context=NULL
    WHERE account_closure_attempts.phase='failed';
  UPDATE public.account_closure_tokens SET phase='processing',consumed_at=clock_timestamp()
    WHERE user_id=p_user_id AND request_id=t.request_id;
  UPDATE public.account_checkout_operations SET closure_request_id=t.request_id
    WHERE user_id=p_user_id;
  IF t.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'closure token expired'; END IF;
  RETURN public.inspect_account_closure_pending(p_user_id);
END;
$$;

-- The old finish RPC only handles the legacy processing phase. Explicitly keep
-- pending durable; errors/timeouts cannot convert confirmed intent back to open.
CREATE OR REPLACE FUNCTION public.finish_account_closure_attempt(p_user_id uuid,p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  UPDATE public.account_closure_attempts SET phase='failed',updated_at=statement_timestamp()
    WHERE user_id=p_user_id AND request_id=p_request_id AND phase='processing';
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.account_closure_tokens SET phase='failed'
    WHERE user_id=p_user_id AND request_id=p_request_id AND phase='processing';
  UPDATE public.account_billing_fences SET phase='open',request_id=NULL
    WHERE user_id=p_user_id AND request_id=p_request_id AND phase='closing';
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_account_checkout_expiry(p_user_id uuid,p_operation_id uuid,p_session_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.account_billing_fences; o public.account_checkout_operations;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  SELECT * INTO f FROM public.account_billing_fences WHERE user_id=p_user_id;
  SELECT * INTO o FROM public.account_checkout_operations WHERE user_id=p_user_id AND operation_id=p_operation_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id) OR f.phase='closing'
    OR (f.phase='pending' AND o.closure_request_id IS DISTINCT FROM f.request_id)
    THEN RAISE EXCEPTION 'account closure pending'; END IF;
  IF o.operation_id IS NULL OR o.session_id IS DISTINCT FROM p_session_id OR o.phase NOT IN ('open','settled')
    THEN RAISE EXCEPTION 'checkout ownership mismatch'; END IF;
  UPDATE public.account_checkout_operations SET phase='settled' WHERE operation_id=o.operation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_account_checkout(p_user_id uuid,p_session_id text,p_customer_id text,p_subscription_id text,
  p_operation_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.account_billing_fences;
BEGIN
  -- Canonical webhook holds the profile first. Match that order for direct
  -- reconciliation too, then serialize with pending/new reservation.
  PERFORM 1 FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  SELECT * INTO f FROM public.account_billing_fences WHERE user_id=p_user_id;
  IF f.phase='closing' THEN RAISE EXCEPTION 'account closure pending'; END IF;
  IF f.phase='pending' AND NOT EXISTS(SELECT 1 FROM public.account_checkout_operations
    WHERE user_id=p_user_id AND operation_id=p_operation_id AND closure_request_id=f.request_id
      AND session_id=p_session_id AND completed_customer_id=p_customer_id AND completed_subscription_id=p_subscription_id)
    THEN RAISE EXCEPTION 'checkout ownership mismatch'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE id=p_user_id AND stripe_customer_id=p_customer_id
    AND stripe_subscription_id=p_subscription_id) THEN RAISE EXCEPTION 'checkout not attached'; END IF;
  IF p_operation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.account_checkout_operations
    WHERE user_id=p_user_id AND operation_id=p_operation_id AND
      (session_id=p_session_id OR (session_id IS NULL AND phase='issuing')))
    THEN RAISE EXCEPTION 'checkout ownership mismatch'; END IF;
  UPDATE public.account_checkout_operations SET phase='settled',session_id=p_session_id
    WHERE user_id=p_user_id AND ((session_id=p_session_id AND phase IN ('open','settled'))
      OR (operation_id=p_operation_id AND phase='issuing' AND session_id IS NULL));
END;
$$;

-- An exact, provider-proven pre-session parameter rejection also completes an
-- admitted operation. It never admits a replacement or clears an unknown result.
CREATE OR REPLACE FUNCTION public.reconcile_rejected_account_checkout(
  p_user_id uuid,p_operation_id uuid,p_request_id text,p_code text,p_param text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_subscription text; f public.account_billing_fences;
BEGIN
  IF p_user_id IS NULL OR p_operation_id IS NULL OR p_request_id IS NULL
    OR p_request_id !~ '^req_[A-Za-z0-9]{1,200}$' OR p_code IS NULL
    OR p_code NOT IN ('parameter_missing','parameter_unknown') OR p_param IS NULL
    OR length(p_param) NOT BETWEEN 1 AND 200 THEN RETURN false; END IF;
  SELECT stripe_subscription_id INTO v_subscription FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  SELECT * INTO f FROM public.account_billing_fences WHERE user_id=p_user_id;
  IF v_subscription IS NOT NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id) OR f.phase='closing'
    OR EXISTS(SELECT 1 FROM public.account_closure_attempts WHERE user_id=p_user_id AND phase NOT IN ('failed','pending'))
    OR (f.phase='pending' AND NOT EXISTS(SELECT 1 FROM public.account_checkout_operations
      WHERE user_id=p_user_id AND operation_id=p_operation_id AND closure_request_id=f.request_id))
    THEN RETURN false; END IF;
  UPDATE public.account_checkout_operations SET phase='settled'
    WHERE user_id=p_user_id AND operation_id=p_operation_id AND phase='issuing' AND session_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.account_checkout_rejections WHERE operation_id=p_operation_id);
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.account_checkout_rejections(operation_id,request_id,code,param)
    VALUES(p_operation_id,p_request_id,p_code,p_param);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_account_closure_billing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.account_billing_fences;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||NEW.id::text,0));
  IF TG_OP='UPDATE' AND (NEW.stripe_customer_id,NEW.stripe_subscription_id,NEW.subscription_id,NEW.subscription_status)
    IS NOT DISTINCT FROM (OLD.stripe_customer_id,OLD.stripe_subscription_id,OLD.subscription_id,OLD.subscription_status)
    THEN RETURN NEW; END IF;
  SELECT * INTO f FROM public.account_billing_fences WHERE user_id=NEW.id;
  IF f.phase='pending' THEN
    IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'account closure fences billing'; END IF;
    -- Existing exact billing identities may reconcile status/cancellation.
    -- First attachment requires the exact admitted checkout's private permit.
    IF NOT (coalesce((OLD.stripe_customer_id IS NOT NULL AND OLD.stripe_subscription_id IS NOT NULL
        AND NEW.stripe_customer_id=OLD.stripe_customer_id
        AND (NEW.stripe_subscription_id IS NULL OR NEW.stripe_subscription_id=OLD.stripe_subscription_id)
        AND NEW.subscription_id IS NOT DISTINCT FROM (CASE WHEN NEW.stripe_subscription_id IS NULL THEN NULL ELSE OLD.subscription_id END)),false)
      OR EXISTS(SELECT 1 FROM public.account_checkout_snapshot_permits p
        JOIN public.account_checkout_operations o ON o.user_id=p.user_id AND o.operation_id=p.operation_id
        WHERE p.user_id=NEW.id AND p.request_id=f.request_id AND o.closure_request_id=f.request_id
          AND p.transaction_id=txid_current() AND NEW.stripe_customer_id=p.customer_id
          AND NEW.stripe_subscription_id=p.subscription_id))
      THEN RAISE EXCEPTION 'account closure fences billing'; END IF;
  ELSIF f.phase='closing' THEN
    IF TG_OP<>'UPDATE' OR NOT EXISTS(SELECT 1 FROM public.account_closure_billing_permits p
      JOIN public.account_closure_attempts a USING(user_id,request_id)
      WHERE p.user_id=NEW.id AND p.transaction_id=txid_current() AND a.phase='processing')
      OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
      OR NEW.stripe_subscription_id IS NOT NULL OR NEW.subscription_id IS NOT NULL
      OR NEW.subscription_status<>'free' THEN RAISE EXCEPTION 'account closure fences billing'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Called only by the signature-verified/hydrated checkout-completion adapter.
-- Applies the actual canonical snapshot + trigger and settles atomically, never
-- grants permission to unrelated subscriptions or new checkout work.
CREATE FUNCTION public.apply_account_checkout_snapshot(
  p_user_id uuid,p_operation_id uuid,p_session_id text,p_event_id text,p_subscription_id text,p_customer_id text,
  p_status text,p_has_approved_price boolean,p_cancel_at_period_end boolean DEFAULT false,
  p_current_period_end bigint DEFAULT NULL,p_event_created bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.account_billing_fences; o public.account_checkout_operations; result jsonb;
BEGIN
  PERFORM 1 FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account profile unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  SELECT * INTO f FROM public.account_billing_fences WHERE user_id=p_user_id;
  SELECT * INTO o FROM public.account_checkout_operations WHERE user_id=p_user_id AND operation_id=p_operation_id FOR UPDATE;
  IF o.operation_id IS NULL OR nullif(btrim(p_session_id),'') IS NULL OR o.phase NOT IN ('issuing','unknown','open','settled')
    OR (o.session_id IS DISTINCT FROM p_session_id AND NOT(o.session_id IS NULL AND o.phase IN ('issuing','unknown')))
    OR (o.completed_customer_id IS NOT NULL AND o.completed_customer_id IS DISTINCT FROM p_customer_id)
    OR (o.completed_subscription_id IS NOT NULL AND o.completed_subscription_id IS DISTINCT FROM p_subscription_id)
    OR f.phase='closing' OR (f.phase='pending' AND o.closure_request_id IS DISTINCT FROM f.request_id)
    THEN RAISE EXCEPTION 'checkout ownership mismatch'; END IF;
  UPDATE public.account_checkout_operations SET session_id=p_session_id,phase=CASE WHEN phase='settled' THEN phase ELSE 'open' END,
    completed_customer_id=p_customer_id,completed_subscription_id=p_subscription_id WHERE operation_id=o.operation_id;
  IF f.phase='pending' THEN
    INSERT INTO public.account_checkout_snapshot_permits VALUES(p_user_id,o.operation_id,f.request_id,p_customer_id,p_subscription_id,txid_current());
  END IF;
  result:=public.apply_stripe_subscription_snapshot(p_event_id,p_subscription_id,p_customer_id,p_status,
    p_has_approved_price,p_cancel_at_period_end,p_current_period_end,p_user_id,p_event_created);
  IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'checkout snapshot refused'; END IF;
  PERFORM public.settle_account_checkout(p_user_id,p_session_id,p_customer_id,p_subscription_id,p_operation_id);
  DELETE FROM public.account_checkout_snapshot_permits WHERE user_id=p_user_id AND transaction_id=txid_current();
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_account_closure_pending_token(uuid,text),
  public.inspect_account_closure_pending(uuid),public.begin_account_closure_pending(uuid,text,boolean),
  public.account_closure_pending_status(),
  public.apply_account_checkout_snapshot(uuid,uuid,text,text,text,text,text,boolean,boolean,bigint,bigint)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.account_closure_pending_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_account_closure_pending_token(uuid,text),public.inspect_account_closure_pending(uuid),
  public.begin_account_closure_pending(uuid,text,boolean),
  public.apply_account_checkout_snapshot(uuid,uuid,text,text,text,text,text,boolean,boolean,bigint,bigint) TO service_role;
-- No function in this slice promotes pending to processing/closing, issues a
-- destructive grant, or changes the disabled legacy rollout. No expiry reopen.
COMMIT;
