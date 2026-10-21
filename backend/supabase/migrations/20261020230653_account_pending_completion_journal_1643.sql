-- #1643 inactive completion authority. Does not select a public caller or enable deletion.
-- Legacy worker/portal coverage is an independently reviewed operational prerequisite,
-- never inferred from missing leases, heartbeat expiry, a provider redirect or cancellation.
BEGIN;
CREATE TABLE public.account_completion_configuration (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  enabled boolean NOT NULL DEFAULT false,
  scope_digest text CHECK(scope_digest ~ '^[a-f0-9]{64}$')
);
INSERT INTO public.account_completion_configuration(singleton) VALUES(true);
CREATE TABLE public.account_completion_coverage (
  user_id uuid NOT NULL, request_id uuid NOT NULL, scope_digest text NOT NULL CHECK(scope_digest ~ '^[a-f0-9]{64}$'),
  legacy_producer_evidence text NOT NULL CHECK(length(btrim(legacy_producer_evidence))>0),
  portal_settlement_evidence text NOT NULL CHECK(length(btrim(portal_settlement_evidence))>0),
  PRIMARY KEY(user_id,request_id,scope_digest)
);
-- Retained independently of Auth. No timer or lease DELETE settles a save.
CREATE TABLE public.account_save_obligations (
  user_id uuid NOT NULL, lease_id uuid NOT NULL, session_id uuid,
  phase text NOT NULL DEFAULT 'admitted' CHECK(phase IN ('admitted','completed')),
  PRIMARY KEY(user_id,lease_id), UNIQUE(session_id)
);
CREATE INDEX account_save_unsettled ON public.account_save_obligations(user_id) WHERE phase<>'completed';
CREATE TABLE public.account_completion_executions (
  user_id uuid PRIMARY KEY, request_id uuid NOT NULL, execution_id uuid NOT NULL UNIQUE,
  scope_digest text NOT NULL, expires_at timestamptz NOT NULL, customer_id text,
  phase text NOT NULL DEFAULT 'processing' CHECK(phase IN ('processing','completed'))
);
CREATE TABLE public.account_completion_stages (
  execution_id uuid NOT NULL REFERENCES public.account_completion_executions(execution_id),
  key text NOT NULL CHECK(key ~ '^(cancel:[A-Za-z0-9_-]{1,128}|settle_billing|delete_customer|retain_trial|remove_storage|delete_auth)$'),
  phase text NOT NULL DEFAULT 'started' CHECK(phase IN ('started','completed','unknown')),
  PRIMARY KEY(execution_id,key)
);
ALTER TABLE public.account_completion_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_completion_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_save_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_completion_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_completion_stages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_completion_configuration,public.account_completion_coverage,public.account_save_obligations,
  public.account_completion_executions,public.account_completion_stages FROM PUBLIC,anon,authenticated,service_role;

-- Existing rows are conservative debt. Unidentified/pre-row legacy work still requires
-- coverage evidence; this backfill does not assert that the historical inventory is complete.
INSERT INTO public.account_save_obligations(user_id,lease_id)
  SELECT user_id,lease_id FROM public.active_recording_lease ON CONFLICT DO NOTHING;
INSERT INTO public.account_save_obligations(user_id,lease_id,session_id)
  SELECT user_id,coalesce(lease_id,id),id FROM public.sessions WHERE status IS DISTINCT FROM 'completed'
  ON CONFLICT(user_id,lease_id) DO UPDATE SET session_id=EXCLUDED.session_id;

CREATE FUNCTION public._account_save_lease_obligation_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.user_id,NEW.lease_id) IS NOT DISTINCT FROM (OLD.user_id,OLD.lease_id) THEN RETURN NEW; END IF;
  INSERT INTO public.account_save_obligations(user_id,lease_id) VALUES(NEW.user_id,NEW.lease_id)
    ON CONFLICT(user_id,lease_id) DO NOTHING;
  IF EXISTS(SELECT 1 FROM public.account_save_obligations WHERE user_id=NEW.user_id AND lease_id=NEW.lease_id AND phase='completed') THEN
    RAISE EXCEPTION 'completed recording identity cannot be reused';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zz_account_save_obligation AFTER INSERT OR UPDATE OF user_id,lease_id ON public.active_recording_lease
  FOR EACH ROW EXECUTE FUNCTION public._account_save_lease_obligation_v1();

CREATE FUNCTION public._account_save_session_obligation_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE identity uuid:=coalesce(NEW.lease_id,NEW.id);
BEGIN
  -- Definite atomic completion is monotonic. Failed/fenced/expired rows retain debt;
  -- they are not proof a recoverable take was saved or explicitly abandoned.
  INSERT INTO public.account_save_obligations(user_id,lease_id,session_id,phase)
    VALUES(NEW.user_id,identity,NEW.id,CASE WHEN NEW.status='completed' THEN 'completed' ELSE 'admitted' END)
    ON CONFLICT(user_id,lease_id) DO UPDATE
      SET session_id=EXCLUDED.session_id,phase=CASE WHEN EXCLUDED.phase='completed' THEN 'completed' ELSE account_save_obligations.phase END
      WHERE account_save_obligations.session_id IS NULL OR account_save_obligations.session_id=EXCLUDED.session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'recording save identity already bound'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zz_account_save_session_obligation AFTER INSERT OR UPDATE OF status ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public._account_save_session_obligation_v1();

CREATE FUNCTION public._account_save_delete_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.account_save_obligations WHERE user_id=OLD.id AND phase<>'completed') THEN
    RAISE EXCEPTION 'account admitted save unsettled' USING ERRCODE='55000';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER account_save_delete_guard BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public._account_save_delete_guard_v1();

CREATE FUNCTION public._account_completion_receipt_v1(p_user_id uuid,p_request_id uuid,p_execution_id uuid,p_scope_digest text,p_key text,p_phase text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT jsonb_build_object('userId',p_user_id,'requestId',p_request_id,'executionId',p_execution_id,
    'scopeDigest',p_scope_digest,'key',p_key,'phase',p_phase)
$$;

CREATE FUNCTION public.claim_account_pending_completion_v1(p_user_id uuid,p_request_id uuid,p_scope_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.account_closure_attempts; t public.account_closure_tokens; e public.account_completion_executions;
  customer text; billing_status text; expiry_ms bigint;
BEGIN
  SELECT stripe_customer_id,subscription_status INTO customer,billing_status FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  -- Preserve the existing policy's paid-identity prerequisite; a missing Stripe
  -- customer must never turn a paid closure into the free-account effect path.
  IF (billing_status='pro' AND customer IS NULL) OR (customer IS NOT NULL AND btrim(customer)='') THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.account_completion_configuration WHERE singleton AND enabled AND scope_digest=p_scope_digest FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO a FROM public.account_closure_attempts WHERE user_id=p_user_id AND request_id=p_request_id AND phase='pending' FOR UPDATE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.account_completion_executions WHERE user_id=p_user_id) THEN RETURN NULL; END IF;
  SELECT * INTO t FROM public.account_closure_tokens WHERE user_id=p_user_id AND request_id=p_request_id
    AND phase='processing' AND consumed_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id AND email_confirmed_at IS NOT NULL
    AND lower(btrim(email))=a.claimed_email AND a.claimed_email=t.email_normalized) THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.account_completion_coverage WHERE user_id=p_user_id AND request_id=p_request_id AND scope_digest=p_scope_digest)
    OR EXISTS(SELECT 1 FROM public.account_checkout_operations WHERE user_id=p_user_id AND phase<>'settled')
    OR EXISTS(SELECT 1 FROM public.account_coaching_operations WHERE user_id=p_user_id AND phase NOT IN ('completed','refused'))
    OR EXISTS(SELECT 1 FROM public.account_save_obligations WHERE user_id=p_user_id AND phase<>'completed')
    OR EXISTS(SELECT 1 FROM public.active_recording_lease WHERE user_id=p_user_id)
    OR NOT EXISTS(SELECT 1 FROM public.account_billing_fences WHERE user_id=p_user_id AND request_id=p_request_id AND phase='pending')
    THEN RETURN jsonb_build_object('outcome','pending'); END IF;
  INSERT INTO public.account_completion_executions(user_id,request_id,execution_id,scope_digest,expires_at,customer_id)
    VALUES(p_user_id,p_request_id,gen_random_uuid(),p_scope_digest,clock_timestamp()+interval '5 minutes',customer) RETURNING * INTO e;
  UPDATE public.account_closure_attempts SET phase='processing',updated_at=clock_timestamp() WHERE user_id=p_user_id;
  UPDATE public.account_billing_fences SET phase='closing' WHERE user_id=p_user_id AND request_id=p_request_id;
  expiry_ms:=floor(extract(epoch FROM e.expires_at)*1000);
  RETURN jsonb_build_object('userId',e.user_id,'requestId',e.request_id,'executionId',e.execution_id,'scopeDigest',e.scope_digest,
    'expiresAt',expiry_ms,'proof',jsonb_build_object('userId',e.user_id,'requestId',e.request_id,
      'email',a.claimed_email,'customerId',customer,'expiresAt',expiry_ms),
    'settled',jsonb_build_object('checkout',true,'saves',true,'coaching',true,'portal',true));
END $$;

CREATE FUNCTION public._account_completion_lock_v1(p_user_id uuid,p_request_id uuid,p_execution_id uuid,p_scope_digest text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  -- Profile can be absent after exact Auth deletion; retain executor identity independently.
  PERFORM 1 FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  PERFORM 1 FROM public.account_completion_configuration WHERE singleton AND enabled AND scope_digest=p_scope_digest FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.account_completion_executions WHERE user_id=p_user_id AND request_id=p_request_id
    AND execution_id=p_execution_id AND scope_digest=p_scope_digest AND phase='processing' AND expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN EXISTS(SELECT 1 FROM public.account_closure_attempts WHERE user_id=p_user_id AND request_id=p_request_id AND phase='processing')
    AND NOT EXISTS(SELECT 1 FROM auth.users u JOIN public.account_closure_attempts a ON a.user_id=u.id
      WHERE u.id=p_user_id AND (u.email_confirmed_at IS NULL OR lower(btrim(u.email)) IS DISTINCT FROM a.claimed_email))
    AND (EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id)
      OR EXISTS(SELECT 1 FROM public.account_completion_stages WHERE execution_id=p_execution_id AND key='delete_auth' AND phase IN ('started','completed')))
    AND EXISTS(SELECT 1 FROM public.account_billing_fences WHERE user_id=p_user_id AND request_id=p_request_id AND phase='closing')
    AND EXISTS(SELECT 1 FROM public.account_completion_coverage WHERE user_id=p_user_id AND request_id=p_request_id AND scope_digest=p_scope_digest)
    AND EXISTS(SELECT 1 FROM public.account_completion_executions WHERE execution_id=p_execution_id AND expires_at>clock_timestamp());
END $$;

CREATE FUNCTION public.inspect_account_pending_completion_v1(p_user_id uuid,p_request_id uuid,p_execution_id uuid,p_scope_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT public._account_completion_lock_v1(p_user_id,p_request_id,p_execution_id,p_scope_digest) THEN RETURN NULL; END IF;
  RETURN public._account_completion_receipt_v1(p_user_id,p_request_id,p_execution_id,p_scope_digest,'authority','processing');
END $$;

CREATE FUNCTION public.begin_account_completion_stage_v1(p_user_id uuid,p_request_id uuid,p_execution_id uuid,p_scope_digest text,p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE observed text;
BEGIN
  IF NOT public._account_completion_lock_v1(p_user_id,p_request_id,p_execution_id,p_scope_digest) THEN RETURN NULL; END IF;
  INSERT INTO public.account_completion_stages(execution_id,key) VALUES(p_execution_id,p_key) ON CONFLICT DO NOTHING;
  IF FOUND THEN observed:='dispatch'; ELSE SELECT phase INTO observed FROM public.account_completion_stages WHERE execution_id=p_execution_id AND key=p_key; END IF;
  RETURN public._account_completion_receipt_v1(p_user_id,p_request_id,p_execution_id,p_scope_digest,p_key,observed);
END $$;

CREATE FUNCTION public.finish_account_completion_stage_v1(p_user_id uuid,p_request_id uuid,p_execution_id uuid,p_scope_digest text,p_key text,p_outcome text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE observed text;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('completed','unknown') THEN RETURN NULL; END IF;
  IF p_outcome='completed' THEN
    IF NOT public._account_completion_lock_v1(p_user_id,p_request_id,p_execution_id,p_scope_digest) THEN RETURN NULL; END IF;
  ELSE
    -- Retaining uncertainty must remain possible after expiry/config invalidation.
    PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
    IF NOT EXISTS(SELECT 1 FROM public.account_completion_executions WHERE user_id=p_user_id AND request_id=p_request_id
      AND execution_id=p_execution_id AND scope_digest=p_scope_digest AND phase='processing') THEN RETURN NULL; END IF;
  END IF;
  UPDATE public.account_completion_stages SET phase=p_outcome WHERE execution_id=p_execution_id AND key=p_key AND phase='started';
  SELECT phase INTO observed FROM public.account_completion_stages WHERE execution_id=p_execution_id AND key=p_key;
  IF observed IS NULL THEN RETURN NULL; END IF;
  RETURN public._account_completion_receipt_v1(p_user_id,p_request_id,p_execution_id,p_scope_digest,p_key,observed);
END $$;

CREATE FUNCTION public.complete_account_pending_completion_v1(p_user_id uuid,p_request_id uuid,p_execution_id uuid,p_scope_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE required text[]:=ARRAY['retain_trial','remove_storage','delete_auth']; claimed_email text;
BEGIN
  IF NOT public._account_completion_lock_v1(p_user_id,p_request_id,p_execution_id,p_scope_digest) THEN RETURN NULL; END IF;
  SELECT a.claimed_email INTO claimed_email FROM public.account_closure_attempts a
    WHERE a.user_id=p_user_id AND a.request_id=p_request_id;
  IF EXISTS(SELECT 1 FROM public.account_completion_executions WHERE execution_id=p_execution_id AND customer_id IS NOT NULL) THEN
    required:=required||ARRAY['settle_billing','delete_customer']; END IF;
  IF EXISTS(SELECT 1 FROM unnest(required) AS r(key) WHERE NOT EXISTS(SELECT 1 FROM public.account_completion_stages s
    WHERE s.execution_id=p_execution_id AND s.key=r.key AND s.phase='completed'))
    OR EXISTS(SELECT 1 FROM public.account_completion_stages WHERE execution_id=p_execution_id AND phase<>'completed')
    OR EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id)
    OR EXISTS(SELECT 1 FROM public.user_profiles WHERE id=p_user_id)
    OR EXISTS(SELECT 1 FROM public.sessions WHERE user_id=p_user_id)
    OR EXISTS(SELECT 1 FROM public.account_save_obligations WHERE user_id=p_user_id AND phase<>'completed')
    OR EXISTS(SELECT 1 FROM public.account_checkout_operations WHERE user_id=p_user_id AND phase<>'settled')
    OR NOT EXISTS(SELECT 1 FROM public.trial_entitlements t WHERE t.email=claimed_email AND t.user_id IS NULL)
    OR EXISTS(SELECT 1 FROM public.list_account_closure_storage(p_user_id))
    OR EXISTS(SELECT 1 FROM storage.objects WHERE name LIKE p_user_id::text||'/%')
    THEN RETURN NULL; END IF;
  -- Only terminal, account-bound identity rows may be cleaned up. Keep this in
  -- the same statement as canonical residue verification so any future FK or
  -- unsupported reference aborts and rolls back fence/journal changes together.
  DELETE FROM public.account_checkout_operations WHERE user_id=p_user_id AND phase='settled';
  DELETE FROM public.account_billing_fences WHERE user_id=p_user_id AND request_id=p_request_id;
  DELETE FROM public.account_save_obligations WHERE user_id=p_user_id AND phase='completed';
  IF public.verify_account_closure_residue(p_user_id,claimed_email) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'account completion residue remains' USING ERRCODE='55000';
  END IF;
  UPDATE public.account_completion_executions SET phase='completed' WHERE execution_id=p_execution_id;
  UPDATE public.account_closure_attempts SET phase='completed',updated_at=clock_timestamp() WHERE user_id=p_user_id AND request_id=p_request_id;
  RETURN public._account_completion_receipt_v1(p_user_id,p_request_id,p_execution_id,p_scope_digest,'completion','completed');
END $$;

-- The legacy error handler may not release a new completion executor's fence.
ALTER FUNCTION public.finish_account_closure_attempt(uuid,uuid) RENAME TO _finish_account_closure_legacy_v1;
REVOKE ALL ON FUNCTION public._finish_account_closure_legacy_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.finish_account_closure_attempt(p_user_id uuid,p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM 1 FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  IF EXISTS(SELECT 1 FROM public.account_completion_executions WHERE user_id=p_user_id AND request_id=p_request_id) THEN RETURN; END IF;
  PERFORM public._finish_account_closure_legacy_v1(p_user_id,p_request_id);
END $$;

REVOKE ALL ON FUNCTION public._account_save_lease_obligation_v1(),public._account_save_session_obligation_v1(),public._account_save_delete_guard_v1(),
  public._account_completion_receipt_v1(uuid,uuid,uuid,text,text,text),public._account_completion_lock_v1(uuid,uuid,uuid,text),
  public.claim_account_pending_completion_v1(uuid,uuid,text),public.inspect_account_pending_completion_v1(uuid,uuid,uuid,text),
  public.begin_account_completion_stage_v1(uuid,uuid,uuid,text,text),public.finish_account_completion_stage_v1(uuid,uuid,uuid,text,text,text),
  public.complete_account_pending_completion_v1(uuid,uuid,uuid,text),public.finish_account_closure_attempt(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_account_pending_completion_v1(uuid,uuid,text),public.inspect_account_pending_completion_v1(uuid,uuid,uuid,text),
  public.begin_account_completion_stage_v1(uuid,uuid,uuid,text,text),public.finish_account_completion_stage_v1(uuid,uuid,uuid,text,text,text),
  public.complete_account_pending_completion_v1(uuid,uuid,uuid,text),public.finish_account_closure_attempt(uuid,uuid) TO service_role;

-- Separate, short-lived status authority. Store only a hash of a random 256-bit
-- capability; never an email-link token, raw bearer secret or owner JWT. This
-- survives Auth deletion to read one request, and grants no effect authority.
CREATE TABLE public.account_completion_status_capabilities (
  user_id uuid NOT NULL,request_id uuid NOT NULL,scope_digest text NOT NULL CHECK(scope_digest ~ '^[a-f0-9]{64}$'),
  token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,acknowledged_at timestamptz,
  PRIMARY KEY(user_id,request_id)
);
ALTER TABLE public.account_completion_status_capabilities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_completion_status_capabilities FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._account_completion_status_owner_v1(p_user_id uuid,p_request_id uuid,p_scope_digest text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  -- Same account/config lock order as completion. The server caller supplies an
  -- independently authenticated owner, never an arbitrary browser user ID.
  PERFORM 1 FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  PERFORM 1 FROM public.account_completion_configuration WHERE singleton AND enabled AND scope_digest=p_scope_digest FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN EXISTS(SELECT 1 FROM public.account_closure_attempts a
    JOIN auth.users u ON u.id=a.user_id
    JOIN public.account_billing_fences f ON f.user_id=a.user_id AND f.request_id=a.request_id
    WHERE a.user_id=p_user_id AND a.request_id=p_request_id AND a.phase='pending' AND f.phase='pending'
      AND u.email_confirmed_at IS NOT NULL AND lower(btrim(u.email))=a.claimed_email)
    AND NOT EXISTS(SELECT 1 FROM public.account_completion_executions WHERE user_id=p_user_id);
END $$;

CREATE FUNCTION public.issue_account_completion_status_v1(p_user_id uuid,p_request_id uuid,p_scope_digest text,p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE deadline timestamptz;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
    OR NOT public._account_completion_status_owner_v1(p_user_id,p_request_id,p_scope_digest) THEN RETURN NULL; END IF;
  INSERT INTO public.account_completion_status_capabilities(user_id,request_id,scope_digest,token_hash,expires_at)
    VALUES(p_user_id,p_request_id,p_scope_digest,p_token_hash,clock_timestamp()+interval '15 minutes')
    ON CONFLICT(user_id,request_id) DO UPDATE SET token_hash=EXCLUDED.token_hash
      WHERE account_completion_status_capabilities.acknowledged_at IS NULL
        AND account_completion_status_capabilities.scope_digest=EXCLUDED.scope_digest
        AND account_completion_status_capabilities.expires_at>clock_timestamp();
  -- A lost issuance reply can be recovered only before acknowledgment, while
  -- the exact confirmed owner is live/pending. Never extend the original
  -- deadline or replace an acknowledged key, including after Auth loss.
  SELECT expires_at INTO deadline FROM public.account_completion_status_capabilities WHERE user_id=p_user_id AND request_id=p_request_id
    AND scope_digest=p_scope_digest AND token_hash=p_token_hash AND expires_at>clock_timestamp();
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('requestId',p_request_id,'expiresAt',floor(extract(epoch FROM deadline)*1000));
END $$;

CREATE FUNCTION public.acknowledge_account_completion_status_v1(p_user_id uuid,p_request_id uuid,p_scope_digest text,p_token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT public._account_completion_status_owner_v1(p_user_id,p_request_id,p_scope_digest) THEN RETURN false; END IF;
  UPDATE public.account_completion_status_capabilities SET acknowledged_at=coalesce(acknowledged_at,clock_timestamp())
    WHERE user_id=p_user_id AND request_id=p_request_id AND scope_digest=p_scope_digest
      AND token_hash=p_token_hash AND expires_at>clock_timestamp();
  RETURN FOUND;
END $$;

CREATE FUNCTION public.read_account_completion_status_v1(p_request_id uuid,p_token_hash text,p_scope_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.account_completion_status_capabilities; a public.account_closure_attempts;
  e public.account_completion_executions; result jsonb; reason text;
BEGIN
  PERFORM 1 FROM public.account_completion_configuration WHERE singleton AND enabled AND scope_digest=p_scope_digest FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.account_completion_status_capabilities WHERE request_id=p_request_id AND token_hash=p_token_hash
    AND scope_digest=p_scope_digest AND acknowledged_at IS NOT NULL AND expires_at>clock_timestamp() FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO a FROM public.account_closure_attempts WHERE user_id=c.user_id AND request_id=c.request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO e FROM public.account_completion_executions WHERE user_id=c.user_id AND request_id=c.request_id AND scope_digest=c.scope_digest;
  IF a.phase<>'completed' AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=c.user_id
    AND (u.email_confirmed_at IS NULL OR lower(btrim(u.email)) IS DISTINCT FROM a.claimed_email)) THEN reason:='identity_unverified';
  ELSIF a.phase='completed' AND e.phase='completed' THEN
    IF public.verify_account_closure_residue(c.user_id,a.claimed_email) IS TRUE THEN
      result:=jsonb_build_object('outcome','completed','requestId',c.request_id,'accountDeleted',true,'canRetry',false);
    ELSE reason:='completion_unverified'; END IF;
  ELSIF e.phase='processing' THEN
    IF EXISTS(SELECT 1 FROM public.account_completion_stages WHERE execution_id=e.execution_id AND key='delete_auth' AND phase IN ('started','unknown'))
      OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=c.user_id) THEN reason:='auth_unknown';
    ELSIF EXISTS(SELECT 1 FROM public.account_completion_stages WHERE execution_id=e.execution_id AND phase='unknown') THEN reason:='operation_unknown';
    ELSIF e.expires_at<=clock_timestamp() THEN reason:='execution_expired';
    ELSE result:=jsonb_build_object('outcome','processing','requestId',c.request_id,'canRetry',false); END IF;
  ELSIF a.phase='pending' AND EXISTS(SELECT 1 FROM public.account_billing_fences WHERE user_id=c.user_id AND request_id=c.request_id AND phase='pending')
    AND EXISTS(SELECT 1 FROM auth.users WHERE id=c.user_id AND email_confirmed_at IS NOT NULL AND lower(btrim(email))=a.claimed_email) THEN
    IF NOT EXISTS(SELECT 1 FROM public.account_completion_coverage WHERE user_id=c.user_id AND request_id=c.request_id AND scope_digest=c.scope_digest)
      THEN reason:='coverage_unverified';
    ELSIF EXISTS(SELECT 1 FROM public.account_checkout_operations WHERE user_id=c.user_id AND phase<>'settled') THEN reason:='checkout_unsettled';
    ELSIF EXISTS(SELECT 1 FROM public.account_save_obligations WHERE user_id=c.user_id AND phase<>'completed')
      OR EXISTS(SELECT 1 FROM public.active_recording_lease WHERE user_id=c.user_id) THEN reason:='save_unsettled';
    ELSIF EXISTS(SELECT 1 FROM public.account_coaching_operations WHERE user_id=c.user_id AND phase NOT IN ('completed','refused')) THEN reason:='coaching_unsettled';
    ELSE reason:='ready'; END IF;
    result:=jsonb_build_object('outcome','pending','requestId',c.request_id,'reason',reason,'canRetry',false);
  ELSE reason:='completion_unverified'; END IF;
  IF result IS NULL THEN result:=jsonb_build_object('outcome','verification_pending','requestId',c.request_id,'reason',reason,'canRetry',false); END IF;
  IF c.expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
  -- Internal transport deadline lets the server reject a response that expired
  -- during an RPC wait. The public mapper strips this field from status replies.
  RETURN result||jsonb_build_object('expiresAt',floor(extract(epoch FROM c.expires_at)*1000));
END $$;
REVOKE ALL ON FUNCTION public._account_completion_status_owner_v1(uuid,uuid,text),
  public.issue_account_completion_status_v1(uuid,uuid,text,text),public.acknowledge_account_completion_status_v1(uuid,uuid,text,text),
  public.read_account_completion_status_v1(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.issue_account_completion_status_v1(uuid,uuid,text,text),
  public.acknowledge_account_completion_status_v1(uuid,uuid,text,text),public.read_account_completion_status_v1(uuid,text,text) TO service_role;
COMMIT;
