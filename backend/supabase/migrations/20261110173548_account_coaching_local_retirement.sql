-- #1643: local coaching write-authority retirement, distinct from remote provider settlement.
-- Source only: applying this schema and deploying its Edge caller require separate authorization.
-- Age permits revoking local write authority for a confirmed closure. It does NOT prove that
-- the remote provider stopped, that a timed-out request was refused, or that deletion ran.
-- Every exact candidate still needs a separately authorized recovery call. No batch update,
-- scheduler, activation, provider request, or deletion is performed by this schema proposal.
BEGIN;

DO $$ BEGIN
  IF to_regprocedure('public.fence_account_coaching_unknown_v1(uuid,uuid,uuid,uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'coaching unknown fence predecessor required';
  END IF;
END $$;

ALTER TABLE public.account_coaching_operations DROP CONSTRAINT account_coaching_operations_phase_check,
  ADD CONSTRAINT account_coaching_operations_phase_check
    CHECK (phase IN ('admitted','completed','refused','unknown','fenced_unknown','fenced_expired','fenced_local'));

-- Independent of Auth, content-free, and readable only by the migration owner. Preserve
-- provider uncertainty and the atomic commit digests even after authorized Auth deletion.
CREATE TABLE public.account_coaching_expiry_fences (
  operation_id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  scope_digest text NOT NULL CHECK (scope_digest ~ '^[a-f0-9]{64}$'),
  user_sha256 text NOT NULL CHECK (user_sha256 ~ '^[a-f0-9]{64}$'),
  session_sha256 text NOT NULL CHECK (session_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  previous_phase text NOT NULL CHECK (previous_phase IN ('admitted','unknown')),
  suggestion_sha256 text CHECK (suggestion_sha256 ~ '^[a-f0-9]{64}$'),
  completion_sha256 text CHECK (completion_sha256 ~ '^[a-f0-9]{64}$'),
  authority text NOT NULL CHECK (authority = 'confirmed_owner_closure'),
  provider_outcome text NOT NULL CHECK (provider_outcome = 'unknown'),
  local_persistence text NOT NULL CHECK (local_persistence IN ('uncommitted','committed')),
  admitted_at timestamptz NOT NULL,
  last_updated_at timestamptz NOT NULL,
  fenced_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((suggestion_sha256 IS NULL) = (completion_sha256 IS NULL)),
  CHECK ((local_persistence = 'uncommitted') = (suggestion_sha256 IS NULL))
);
ALTER TABLE public.account_coaching_expiry_fences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_coaching_expiry_fences FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fence_account_coaching_expired_v1(p_operation_id uuid,p_user_id uuid,p_session_id uuid,
  p_request_id uuid,p_scope_digest text,p_evidence_sha256 text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.account_coaching_operations; prior public.account_coaching_expiry_fences;
  user_digest text; session_digest text; capability_expiry timestamptz;
BEGIN
  IF p_operation_id IS NULL OR p_user_id IS NULL OR p_session_id IS NULL OR p_request_id IS NULL
    OR p_scope_digest IS NULL OR p_scope_digest !~ '^[a-f0-9]{64}$'
    OR p_evidence_sha256 IS NULL OR p_evidence_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'coaching fence identity and evidence required' USING ERRCODE='22023';
  END IF;
  user_digest:=encode(sha256(convert_to('account-coaching-expiry:user:v1:'||p_user_id::text,'UTF8')),'hex');
  session_digest:=encode(sha256(convert_to('account-coaching-expiry:session:v1:'||p_session_id::text,'UTF8')),'hex');
  -- Same order as admission/persistence: profile, account, operation. Recheck after waits.
  PERFORM 1 FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO prior FROM public.account_coaching_expiry_fences WHERE operation_id=p_operation_id;
    IF FOUND AND prior.user_sha256=user_digest AND prior.session_sha256=session_digest
      AND prior.request_id=p_request_id AND prior.scope_digest=p_scope_digest
      AND prior.evidence_sha256=p_evidence_sha256 THEN RETURN true; END IF;
    RAISE EXCEPTION 'coaching operation not found' USING ERRCODE='55000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  SELECT * INTO op FROM public.account_coaching_operations WHERE operation_id=p_operation_id
    AND user_id=p_user_id AND session_id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'coaching operation not found' USING ERRCODE='55000'; END IF;
  IF op.phase='fenced_expired' THEN
    SELECT * INTO prior FROM public.account_coaching_expiry_fences WHERE operation_id=p_operation_id;
    IF FOUND AND prior.user_sha256=user_digest AND prior.session_sha256=session_digest
      AND prior.request_id=p_request_id AND prior.scope_digest=p_scope_digest
      AND prior.evidence_sha256=p_evidence_sha256 THEN RETURN true; END IF;
    RAISE EXCEPTION 'coaching fence evidence differs' USING ERRCODE='55000';
  END IF;

  PERFORM 1 FROM public.account_completion_configuration
    WHERE singleton AND enabled AND scope_digest=p_scope_digest FOR SHARE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.account_completion_executions WHERE user_id=p_user_id) THEN
    RAISE EXCEPTION 'coaching fence requires a confirmed account closure' USING ERRCODE='55000';
  END IF;
  SELECT c.expires_at INTO capability_expiry
    FROM public.account_closure_attempts a
    JOIN auth.users u ON u.id=a.user_id
    JOIN public.account_billing_fences f ON f.user_id=a.user_id AND f.request_id=a.request_id
    JOIN public.account_closure_tokens t ON t.user_id=a.user_id AND t.request_id=a.request_id
    JOIN public.account_completion_status_capabilities c ON c.user_id=a.user_id AND c.request_id=a.request_id
    WHERE a.user_id=p_user_id AND a.request_id=p_request_id AND a.phase='pending' AND f.phase='pending'
      AND u.email_confirmed_at IS NOT NULL AND lower(btrim(u.email))=a.claimed_email
      AND t.phase='processing' AND t.consumed_at IS NOT NULL AND t.email_normalized=a.claimed_email
      AND c.scope_digest=p_scope_digest AND c.acknowledged_at IS NOT NULL AND c.expires_at>clock_timestamp()
    FOR SHARE OF a,u,f,t,c;
  IF NOT FOUND OR capability_expiry<=clock_timestamp() THEN
    RAISE EXCEPTION 'coaching fence requires a confirmed account closure' USING ERRCODE='55000';
  END IF;
  -- Both clocks must be old: an old admission with a recent writer update is not a candidate.
  IF op.phase NOT IN ('admitted','unknown')
    OR greatest(op.admitted_at,op.updated_at)>=clock_timestamp()-interval '15 minutes'
    OR (op.phase='admitted' AND op.suggestion_sha256 IS NOT NULL)
    OR (op.suggestion_sha256 IS NULL) IS DISTINCT FROM (op.completion_sha256 IS NULL) THEN
    RAISE EXCEPTION 'coaching operation not expired or not fenceable' USING ERRCODE='55000';
  END IF;

  UPDATE public.account_coaching_operations SET phase='fenced_expired',updated_at=clock_timestamp()
    WHERE operation_id=op.operation_id;
  INSERT INTO public.account_coaching_expiry_fences(operation_id,request_id,scope_digest,user_sha256,session_sha256,
    evidence_sha256,previous_phase,suggestion_sha256,completion_sha256,authority,provider_outcome,
    local_persistence,admitted_at,last_updated_at)
    VALUES(op.operation_id,p_request_id,p_scope_digest,user_digest,session_digest,p_evidence_sha256,op.phase,
      op.suggestion_sha256,op.completion_sha256,'confirmed_owner_closure','unknown',
      CASE WHEN op.suggestion_sha256 IS NULL THEN 'uncommitted' ELSE 'committed' END,op.admitted_at,op.updated_at);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.fence_account_coaching_expired_v1(uuid,uuid,uuid,uuid,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fence_account_coaching_expired_v1(uuid,uuid,uuid,uuid,text,text) TO service_role;

-- The four complete replacement definitions below are generated from the pinned predecessor,
-- with fenced_expired/fenced_local added to terminal/readiness sets and W1's pre-replay refusal.


-- Forward path: the trusted Edge handler calls this only from its awaited finally,
-- after every provider/persist await. This retires local write authority, not the
-- remote provider request. Unlike stale recovery it needs no closure request.
CREATE TABLE public.account_coaching_local_fences (
  operation_id uuid PRIMARY KEY,
  user_sha256 text NOT NULL CHECK (user_sha256 ~ '^[a-f0-9]{64}$'),
  session_sha256 text NOT NULL CHECK (session_sha256 ~ '^[a-f0-9]{64}$'),
  previous_phase text NOT NULL CHECK (previous_phase IN ('admitted','unknown')),
  suggestion_sha256 text CHECK (suggestion_sha256 ~ '^[a-f0-9]{64}$'),
  completion_sha256 text CHECK (completion_sha256 ~ '^[a-f0-9]{64}$'),
  authority text NOT NULL CHECK (authority = 'edge_handler_finished'),
  provider_outcome text NOT NULL CHECK (provider_outcome = 'unknown'),
  local_persistence text NOT NULL CHECK (local_persistence IN ('uncommitted','committed')),
  fenced_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((suggestion_sha256 IS NULL) = (completion_sha256 IS NULL)),
  CHECK ((local_persistence = 'uncommitted') = (suggestion_sha256 IS NULL))
);
ALTER TABLE public.account_coaching_local_fences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_coaching_local_fences FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.finish_account_coaching_local_v1(p_user_id uuid,p_session_id uuid,p_operation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.account_coaching_operations; prior public.account_coaching_local_fences;
  user_digest text; session_digest text;
BEGIN
  IF p_user_id IS NULL OR p_session_id IS NULL OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'coaching identity required' USING ERRCODE='22023';
  END IF;
  user_digest:=encode(sha256(convert_to('account-coaching-local:user:v1:'||p_user_id::text,'UTF8')),'hex');
  session_digest:=encode(sha256(convert_to('account-coaching-local:session:v1:'||p_session_id::text,'UTF8')),'hex');
  PERFORM 1 FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO prior FROM public.account_coaching_local_fences WHERE operation_id=p_operation_id;
    RETURN FOUND AND prior.user_sha256=user_digest AND prior.session_sha256=session_digest;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  SELECT * INTO op FROM public.account_coaching_operations WHERE operation_id=p_operation_id
    AND user_id=p_user_id AND session_id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF op.phase='fenced_local' THEN
    SELECT * INTO prior FROM public.account_coaching_local_fences WHERE operation_id=p_operation_id;
    RETURN FOUND AND prior.user_sha256=user_digest AND prior.session_sha256=session_digest;
  END IF;
  -- A lost reply from a known completion/failure is already terminal. Never rewrite it.
  IF op.phase IN ('completed','refused','fenced_unknown','fenced_expired') THEN RETURN true; END IF;
  IF op.phase NOT IN ('admitted','unknown')
    OR (op.suggestion_sha256 IS NULL) IS DISTINCT FROM (op.completion_sha256 IS NULL)
    OR (op.phase='admitted' AND op.suggestion_sha256 IS NOT NULL) THEN
    RETURN false;
  END IF;
  UPDATE public.account_coaching_operations SET phase='fenced_local',updated_at=clock_timestamp()
    WHERE operation_id=op.operation_id;
  INSERT INTO public.account_coaching_local_fences(operation_id,user_sha256,session_sha256,previous_phase,
    suggestion_sha256,completion_sha256,authority,provider_outcome,local_persistence)
    VALUES(op.operation_id,user_digest,session_digest,op.phase,op.suggestion_sha256,op.completion_sha256,
      'edge_handler_finished','unknown',CASE WHEN op.suggestion_sha256 IS NULL THEN 'uncommitted' ELSE 'committed' END);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.finish_account_coaching_local_v1(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finish_account_coaching_local_v1(uuid,uuid,uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.guard_unsettled_account_coaching_delete_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF OLD.phase NOT IN ('completed','refused','fenced_unknown','fenced_expired','fenced_local') THEN
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
  IF FOUND AND op.phase IN ('fenced_unknown','fenced_expired','fenced_local') THEN
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
    OR EXISTS(SELECT 1 FROM public.account_coaching_operations WHERE user_id=p_user_id AND phase NOT IN ('completed','refused','fenced_unknown','fenced_expired','fenced_local'))
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
    ELSIF EXISTS(SELECT 1 FROM public.account_coaching_operations WHERE user_id=c.user_id AND phase NOT IN ('completed','refused','fenced_unknown','fenced_expired','fenced_local')) THEN reason:='coaching_unsettled';
    ELSE reason:='ready'; END IF;
    result:=jsonb_build_object('outcome','pending','requestId',c.request_id,'reason',reason,'canRetry',false);
  ELSE reason:='completion_unverified'; END IF;
  IF result IS NULL THEN result:=jsonb_build_object('outcome','verification_pending','requestId',c.request_id,'reason',reason,'canRetry',false); END IF;
  IF c.expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
  -- Internal transport deadline lets the server reject a response that expired
  -- during an RPC wait. The public mapper strips this field from status replies.
  RETURN result||jsonb_build_object('expiresAt',floor(extract(epoch FROM c.expires_at)*1000));
END $$;

COMMIT;
