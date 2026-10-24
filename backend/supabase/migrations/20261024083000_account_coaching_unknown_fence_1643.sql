-- #1643: terminal fence for an UNKNOWN coaching operation that provably never committed, under a confirmed owner closure.
-- An UNKNOWN operation cannot settle on the live path (provider outcome unknowable), so the M5 delete guard and the M6
-- claim/status hold the account forever. The fence makes it terminal ONLY when, under W1's exact lock order, the operation
-- is UNKNOWN with no committed suggestion/completion digest AND the caller names a confirmed closure request: attempt and
-- billing fence pending, verified identity, enabled scope, and the owner's acknowledged, unexpired status capability for
-- exactly that request and scope. The operation triple alone is never authority. Every writer then refuses the operation.
-- The status RPC's reply shape is unchanged (the deployed Edge parser accepts a closed key set); the unknown provider
-- outcome is recorded in a content-free audit row that survives Auth deletion.
-- Direct coaching writes are closed: sessions.ai_suggestions is written only inside the definer writers (W1 -> W2, the
-- retention purge), receipts only through definer RPCs, and W2 is no longer directly executable by service_role.
-- No row is touched by applying this migration. NOT APPLIED BY MERGE; applying it is a separate, authorized step.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.persist_account_coaching_v1(uuid,boolean,uuid,uuid,jsonb,text,text,text,date,integer,integer)') IS NULL
    OR to_regprocedure('public.read_account_completion_status_v1(uuid,text,text)') IS NULL
    OR to_regprocedure('public.record_ai_suggestion_cache_read_v1(uuid,uuid)') IS NULL
    OR to_regprocedure('public.purge_derived_content_on_expire()') IS NULL THEN
    RAISE EXCEPTION 'coaching admission, completion journal, authority receipt and retention purge predecessors required';
  END IF;
END $$;

ALTER TABLE public.account_coaching_operations DROP CONSTRAINT account_coaching_operations_phase_check,
  ADD CONSTRAINT account_coaching_operations_phase_check
    CHECK (phase IN ('admitted','completed','refused','unknown','fenced_unknown')),
  ADD CONSTRAINT account_coaching_operations_fenced_uncommitted
    CHECK (phase <> 'fenced_unknown' OR (suggestion_sha256 IS NULL AND completion_sha256 IS NULL));

-- Content-free and independent of Auth: no foreign key, no plaintext user id, so it survives the account's deletion.
CREATE TABLE public.account_coaching_fences (
  operation_id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  scope_digest text NOT NULL CHECK (scope_digest ~ '^[a-f0-9]{64}$'),
  user_sha256 text NOT NULL CHECK (user_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  authority text NOT NULL CHECK (authority = 'confirmed_owner_closure'),
  provider_outcome text NOT NULL CHECK (provider_outcome = 'unknown'),
  fenced_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.account_coaching_fences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_coaching_fences FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.guard_unsettled_account_coaching_delete_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF OLD.phase NOT IN ('completed','refused','fenced_unknown') THEN
    RAISE EXCEPTION 'account coaching operation unsettled' USING ERRCODE='55000';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.persist_account_coaching_v1(
  p_operation_id uuid,p_provider_settled boolean,p_session_id uuid,p_user_id uuid,p_suggestions jsonb,
  p_provider text,p_model text,p_quota_scope text,p_quota_utc_date date,p_quota_limit integer,p_quota_request_number integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.account_coaching_operations; saved jsonb; digest text; completion_digest text;
BEGIN
  IF p_provider_settled IS NULL THEN RAISE EXCEPTION 'provider settlement required'; END IF;
  PERFORM 1 FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  SELECT * INTO op FROM public.account_coaching_operations WHERE operation_id=p_operation_id
    AND user_id=p_user_id AND session_id=p_session_id FOR UPDATE;
  IF FOUND AND op.phase='fenced_unknown' THEN
    RAISE EXCEPTION 'coaching operation fenced' USING ERRCODE='55000';
  END IF;
  IF NOT FOUND OR op.phase='refused' THEN RAISE EXCEPTION 'unadmitted coaching completion'; END IF;
  digest:=encode(sha256(convert_to(p_suggestions::text,'UTF8')),'hex');
  completion_digest:=encode(sha256(convert_to(jsonb_build_array(p_suggestions,p_provider,p_model,
    p_quota_scope,p_quota_utc_date,p_quota_limit,p_quota_request_number)::text,'UTF8')),'hex');
  IF op.suggestion_sha256 IS NOT NULL THEN
    -- A lost reply may recover the SAME durable value; never rewrite an operation or another saved result.
    SELECT ai_suggestions INTO saved FROM public.sessions WHERE id=p_session_id AND user_id=p_user_id;
    IF digest IS DISTINCT FROM op.suggestion_sha256 OR completion_digest IS DISTINCT FROM op.completion_sha256 OR saved IS NULL
      OR encode(sha256(convert_to(saved::text,'UTF8')),'hex') IS DISTINCT FROM op.suggestion_sha256 THEN
      RAISE EXCEPTION 'coaching completion replay differs';
    END IF;
    RETURN saved;
  END IF;
  saved:=public.persist_ai_suggestion_with_authority_v1(p_session_id,p_user_id,p_suggestions,p_provider,p_model,
    p_quota_scope,p_quota_utc_date,p_quota_limit,p_quota_request_number);
  UPDATE public.account_coaching_operations SET suggestion_sha256=digest,completion_sha256=completion_digest,
    phase=CASE WHEN op.phase='unknown' OR NOT p_provider_settled THEN 'unknown' ELSE 'completed' END,
    updated_at=clock_timestamp() WHERE operation_id=op.operation_id;
  RETURN saved;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_account_pending_completion_v1(p_user_id uuid,p_request_id uuid,p_scope_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.account_closure_attempts; t public.account_closure_tokens; e public.account_completion_executions;
  customer text; billing_status text; expiry_ms bigint; execution_deadline timestamptz;
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
  -- One deadline, captured after every lock, bounds the execution grant and is what the status capability must outlive.
  execution_deadline:=clock_timestamp()+interval '5 minutes';
  IF NOT EXISTS(SELECT 1 FROM public.account_completion_coverage WHERE user_id=p_user_id AND request_id=p_request_id AND scope_digest=p_scope_digest)
    OR EXISTS(SELECT 1 FROM public.account_checkout_operations WHERE user_id=p_user_id AND phase<>'settled')
    OR EXISTS(SELECT 1 FROM public.account_coaching_operations WHERE user_id=p_user_id AND phase NOT IN ('completed','refused','fenced_unknown'))
    OR EXISTS(SELECT 1 FROM public.account_save_obligations WHERE user_id=p_user_id AND phase<>'completed')
    OR EXISTS(SELECT 1 FROM public.active_recording_lease WHERE user_id=p_user_id)
    OR NOT EXISTS(SELECT 1 FROM public.account_billing_fences WHERE user_id=p_user_id AND request_id=p_request_id AND phase='pending')
    -- The owner must already hold an ACKNOWLEDGED status capability for exactly this request and scope that outlives the
    -- execution grant. Claiming first would refuse a later acknowledgment (an execution would exist), and a capability
    -- expiring while the grant is live could not read the result after Auth deletion.
    OR NOT EXISTS(SELECT 1 FROM public.account_completion_status_capabilities WHERE user_id=p_user_id AND request_id=p_request_id
      AND scope_digest=p_scope_digest AND acknowledged_at IS NOT NULL AND expires_at>execution_deadline)
    THEN RETURN jsonb_build_object('outcome','pending'); END IF;
  INSERT INTO public.account_completion_executions(user_id,request_id,execution_id,scope_digest,expires_at,customer_id)
    VALUES(p_user_id,p_request_id,gen_random_uuid(),p_scope_digest,execution_deadline,customer) RETURNING * INTO e;
  UPDATE public.account_closure_attempts SET phase='processing',updated_at=clock_timestamp() WHERE user_id=p_user_id;
  UPDATE public.account_billing_fences SET phase='closing' WHERE user_id=p_user_id AND request_id=p_request_id;
  expiry_ms:=floor(extract(epoch FROM e.expires_at)*1000);
  RETURN jsonb_build_object('userId',e.user_id,'requestId',e.request_id,'executionId',e.execution_id,'scopeDigest',e.scope_digest,
    'expiresAt',expiry_ms,'proof',jsonb_build_object('userId',e.user_id,'requestId',e.request_id,
      'email',a.claimed_email,'customerId',customer,'expiresAt',expiry_ms),
    'settled',jsonb_build_object('checkout',true,'saves',true,'coaching',true,'portal',true));
END $$;

CREATE OR REPLACE FUNCTION public.read_account_completion_status_v1(p_request_id uuid,p_token_hash text,p_scope_digest text)
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
    ELSIF EXISTS(SELECT 1 FROM public.account_coaching_operations WHERE user_id=c.user_id AND phase NOT IN ('completed','refused','fenced_unknown')) THEN reason:='coaching_unsettled';
    ELSE reason:='ready'; END IF;
    result:=jsonb_build_object('outcome','pending','requestId',c.request_id,'reason',reason,'canRetry',false);
  ELSE reason:='completion_unverified'; END IF;
  IF result IS NULL THEN result:=jsonb_build_object('outcome','verification_pending','requestId',c.request_id,'reason',reason,'canRetry',false); END IF;
  IF c.expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
  -- Internal transport deadline lets the server reject a response that expired
  -- during an RPC wait. The public mapper strips this field from status replies.
  RETURN result||jsonb_build_object('expiresAt',floor(extract(epoch FROM c.expires_at)*1000));
END $$;

CREATE FUNCTION public.fence_account_coaching_unknown_v1(p_operation_id uuid,p_user_id uuid,p_session_id uuid,
  p_request_id uuid,p_scope_digest text,p_evidence_sha256 text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.account_coaching_operations; prior public.account_coaching_fences; user_digest text;
BEGIN
  IF p_operation_id IS NULL OR p_user_id IS NULL OR p_session_id IS NULL
    OR p_evidence_sha256 IS NULL OR p_evidence_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'coaching fence identity and evidence required' USING ERRCODE='22023';
  END IF;
  user_digest:=encode(sha256(convert_to('account-coaching-fence:v1:'||p_user_id::text,'UTF8')),'hex');
  -- W1's lock order: profile, account, then the exact operation triple.
  PERFORM 1 FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    -- Authorized Auth deletion may already have cascaded the fenced operation; the same fence replays from its audit row.
    SELECT * INTO prior FROM public.account_coaching_fences WHERE operation_id=p_operation_id;
    IF FOUND AND prior.user_sha256=user_digest AND prior.request_id=p_request_id AND prior.scope_digest=p_scope_digest
      AND prior.evidence_sha256=p_evidence_sha256 THEN RETURN true; END IF;
    RAISE EXCEPTION 'coaching operation not found' USING ERRCODE='55000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  SELECT * INTO op FROM public.account_coaching_operations WHERE operation_id=p_operation_id
    AND user_id=p_user_id AND session_id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'coaching operation not found' USING ERRCODE='55000'; END IF;
  IF op.phase='fenced_unknown' THEN
    SELECT * INTO prior FROM public.account_coaching_fences WHERE operation_id=p_operation_id;
    IF FOUND AND prior.request_id=p_request_id AND prior.scope_digest=p_scope_digest
      AND prior.evidence_sha256=p_evidence_sha256 THEN RETURN true; END IF;
    RAISE EXCEPTION 'coaching fence evidence differs' USING ERRCODE='55000';
  END IF;
  -- Authority: the named request is this owner's confirmed closure, not merely two pending rows.
  PERFORM 1 FROM public.account_completion_configuration WHERE singleton AND enabled AND scope_digest=p_scope_digest FOR SHARE;
  IF NOT FOUND OR p_request_id IS NULL
    OR EXISTS(SELECT 1 FROM public.account_completion_executions WHERE user_id=p_user_id)
    OR NOT EXISTS(SELECT 1 FROM public.account_closure_attempts a
      JOIN auth.users u ON u.id=a.user_id
      JOIN public.account_billing_fences f ON f.user_id=a.user_id AND f.request_id=a.request_id
      JOIN public.account_completion_status_capabilities c ON c.user_id=a.user_id AND c.request_id=a.request_id
      WHERE a.user_id=p_user_id AND a.request_id=p_request_id AND a.phase='pending' AND f.phase='pending'
        AND u.email_confirmed_at IS NOT NULL AND lower(btrim(u.email))=a.claimed_email
        AND c.scope_digest=p_scope_digest AND c.acknowledged_at IS NOT NULL AND c.expires_at>clock_timestamp()) THEN
    RAISE EXCEPTION 'coaching fence requires a confirmed account closure' USING ERRCODE='55000';
  END IF;
  -- Only an UNKNOWN operation whose persist never committed: W1 writes both digests in the transaction that saves.
  IF op.phase<>'unknown' OR op.suggestion_sha256 IS NOT NULL OR op.completion_sha256 IS NOT NULL THEN
    RAISE EXCEPTION 'coaching operation not fenceable' USING ERRCODE='55000';
  END IF;
  UPDATE public.account_coaching_operations SET phase='fenced_unknown',updated_at=clock_timestamp()
    WHERE operation_id=op.operation_id;
  INSERT INTO public.account_coaching_fences(operation_id,request_id,scope_digest,user_sha256,evidence_sha256,authority,provider_outcome)
    VALUES(op.operation_id,p_request_id,p_scope_digest,user_digest,p_evidence_sha256,'confirmed_owner_closure','unknown');
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.fence_account_coaching_unknown_v1(uuid,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fence_account_coaching_unknown_v1(uuid,uuid,uuid,uuid,text,text) TO service_role;

-- SECURITY INVOKER: current_user is the role performing the write. Inside a definer writer (W1 -> W2, the retention
-- purge) that is the owner; a direct API write runs as anon/authenticated/service_role and is refused. Never a
-- self-bypassing definer.
CREATE FUNCTION public.guard_account_coaching_ai_suggestions_write_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF current_user IN ('anon','authenticated','service_role') THEN
    RAISE EXCEPTION 'sessions.ai_suggestions is written only by the coaching authority' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_account_coaching_ai_suggestions_write_v1() FROM PUBLIC,anon,authenticated,service_role;
-- The leading `a_` orders these before other BEFORE triggers, so a direct write is refused for this reason first.
CREATE TRIGGER a_guard_account_coaching_ai_suggestions_insert BEFORE INSERT ON public.sessions
  FOR EACH ROW WHEN (NEW.ai_suggestions IS NOT NULL)
  EXECUTE FUNCTION public.guard_account_coaching_ai_suggestions_write_v1();
CREATE TRIGGER a_guard_account_coaching_ai_suggestions_update BEFORE UPDATE OF ai_suggestions ON public.sessions
  FOR EACH ROW WHEN (NEW.ai_suggestions IS DISTINCT FROM OLD.ai_suggestions)
  EXECUTE FUNCTION public.guard_account_coaching_ai_suggestions_write_v1();

-- Same body and grants as 20260910193000, now a definer so the receipt table needs no service_role write privilege.
CREATE OR REPLACE FUNCTION public.record_ai_suggestion_cache_read_v1(
  p_session_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  -- A replay counts only while the saved value is still the exact payload the receipt bound. A value
  -- rewritten by any other path cannot accumulate cache-replay evidence under the original receipt.
  UPDATE public.ai_suggestion_authority_receipts AS r
     SET cache_read_count = r.cache_read_count + 1,
         updated_at = now()
    FROM public.sessions AS s
   WHERE r.session_id = p_session_id
     AND r.user_id = p_user_id
     AND s.id = r.session_id
     AND s.user_id = r.user_id
     AND s.ai_suggestions IS NOT NULL
     AND encode(sha256(convert_to(s.ai_suggestions::text, 'UTF8')), 'hex') = r.suggestion_sha256;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.record_ai_suggestion_cache_read_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_suggestion_cache_read_v1(uuid, uuid) TO service_role;

REVOKE INSERT, UPDATE ON public.ai_suggestion_authority_receipts FROM service_role;
-- W1's owner still executes W2 inside W1; no API role may call the inner writer directly.
REVOKE ALL ON FUNCTION public.persist_ai_suggestion_with_authority_v1(uuid,uuid,jsonb,text,text,text,date,integer,integer)
  FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
