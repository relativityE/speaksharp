BEGIN;
-- Forward-only prerequisite; applying source never enables account deletion.
DO $guard$
BEGIN
  PERFORM 1 FROM public.account_billing_coordination WHERE singleton
    AND NOT checkout_workers_drained AND evidence_reference IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'deletion must remain disabled before enforcement apply'; END IF;
  PERFORM 1 FROM public.account_closure_attestation_state WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'drain persistence prerequisite missing'; END IF;
END;
$guard$;

-- This is part of the existing private, cascade-surviving claim journal. Old
-- requests receive no invented authority; an issued token must be claimed via
-- the new wrapper, or an uncertain post-Auth request explicitly reconciled.
ALTER TABLE public.account_closure_attempts
  ADD COLUMN drain_attestation_id uuid REFERENCES public.account_closure_drain_attestations(attestation_id),
  ADD COLUMN drain_generation bigint,
  ADD COLUMN drain_binding_digest text,
  ADD COLUMN drain_context jsonb,
  ADD CONSTRAINT account_closure_attempt_drain_binding CHECK (
    (drain_attestation_id IS NULL AND drain_generation IS NULL AND drain_binding_digest IS NULL AND drain_context IS NULL)
    OR (drain_attestation_id IS NOT NULL AND drain_generation IS NOT NULL AND drain_generation>=0
      AND drain_binding_digest IS NOT NULL AND drain_binding_digest ~ '^[a-f0-9]{64}$'
      AND drain_context IS NOT NULL AND jsonb_typeof(drain_context)='object'));

-- Internal only. External facts are independently supplied by a trusted
-- release/controller adapter, never a browser request. The service must bind
-- this database, the context collector and Auth to the SAME verified target.
CREATE FUNCTION public.require_account_closure_drain(
  p_attestation_id uuid,p_generation bigint,p_binding_digest text,p_context jsonb)
RETURNS public.account_closure_drain_attestations
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.account_closure_attestation_state; a public.account_closure_drain_attestations;
  actual_now timestamptz; created timestamptz;
BEGIN
  -- Registration/invalidation use this same coordination→generation order.
  PERFORM 1 FROM public.account_billing_coordination WHERE singleton FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'coordination state missing'; END IF;
  SELECT * INTO STRICT s FROM public.account_closure_attestation_state WHERE singleton FOR SHARE;
  SELECT * INTO a FROM public.account_closure_drain_attestations
    WHERE attestation_id=p_attestation_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'drain authority unavailable'; END IF;
  actual_now:=clock_timestamp();
  IF p_generation IS NULL OR p_generation<0 OR p_binding_digest IS NULL
    OR p_binding_digest !~ '^[a-f0-9]{64}$'
    OR s.generation IS DISTINCT FROM p_generation OR s.binding_digest IS DISTINCT FROM p_binding_digest
    OR a.generation IS DISTINCT FROM p_generation OR a.binding_digest IS DISTINCT FROM p_binding_digest
    OR a.invalidated_at IS NOT NULL OR a.expires_at<=actual_now OR a.recorded_at>actual_now
    THEN RAISE EXCEPTION 'stale drain authority'; END IF;
  IF jsonb_typeof(p_context) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_context))<>5
    OR NOT p_context ?& ARRAY['candidateSha','configDigest','migrationDigest','projectId','environment']
    OR NOT coalesce(p_context->>'candidateSha' ~ '^[a-f0-9]{40}$',false)
    OR NOT coalesce(p_context->>'configDigest' ~ '^[a-f0-9]{64}$',false)
    OR NOT coalesce(p_context->>'migrationDigest' ~ '^[a-f0-9]{64}$',false)
    OR NOT coalesce(p_context->>'projectId' ~ '^[a-zA-Z0-9_.:-]{1,160}$',false)
    OR NOT coalesce(p_context->>'environment' IN ('production','disposable'),false)
    OR a.record->>'candidateSha' IS DISTINCT FROM p_context->>'candidateSha'
    OR a.record->>'configDigest' IS DISTINCT FROM p_context->>'configDigest'
    OR a.record->>'migrationDigest' IS DISTINCT FROM p_context->>'migrationDigest'
    OR a.record->'target'->>'projectId' IS DISTINCT FROM p_context->>'projectId'
    OR a.record->'target'->>'environment' IS DISTINCT FROM p_context->>'environment'
    OR a.record->>'bindingDigest' IS DISTINCT FROM p_binding_digest
    OR a.validation->>'bindingDigest' IS DISTINCT FROM p_binding_digest
    OR a.validation->>'evidenceDigest' IS DISTINCT FROM a.evidence_digest
    OR a.validation->>'validation' IS DISTINCT FROM 'OFFLINE_VALID'
    OR a.record->'payments'->'frontendEnabled' IS DISTINCT FROM 'false'::jsonb
    OR a.record->'payments'->'backendEnabled' IS DISTINCT FROM 'false'::jsonb
    THEN RAISE EXCEPTION 'drain context mismatch'; END IF;
  created:=(a.record->>'createdAt')::timestamptz;
  IF created IS NULL OR created>actual_now OR a.expires_at<=created
    OR a.expires_at-created>interval '15 minutes'
    OR (a.record->>'expiresAt')::timestamptz IS DISTINCT FROM a.expires_at
    THEN RAISE EXCEPTION 'stale drain authority'; END IF;
  RETURN a;
END;
$$;

CREATE FUNCTION public.require_account_closure_request_authority(
  p_user_id uuid,p_request_id uuid,p_attestation_id uuid,p_generation bigint,p_binding_digest text,p_context jsonb)
RETURNS public.account_closure_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.account_closure_attempts;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  PERFORM public.require_account_closure_drain(p_attestation_id,p_generation,p_binding_digest,p_context);
  SELECT * INTO a FROM public.account_closure_attempts WHERE user_id=p_user_id AND request_id=p_request_id FOR UPDATE;
  IF NOT FOUND OR a.phase='failed' OR a.drain_attestation_id IS DISTINCT FROM p_attestation_id
    OR a.drain_generation IS DISTINCT FROM p_generation OR a.drain_binding_digest IS DISTINCT FROM p_binding_digest
    OR a.drain_context IS DISTINCT FROM p_context THEN RAISE EXCEPTION 'request drain authority mismatch'; END IF;
  -- Recheck the actual clock AFTER the journal lock too. No statement-start
  -- timestamp or earlier RPC result may authorize a later consuming boundary.
  PERFORM public.require_account_closure_drain(p_attestation_id,p_generation,p_binding_digest,p_context);
  IF a.phase='processing' THEN
    IF NOT EXISTS(SELECT 1 FROM public.account_billing_coordination WHERE singleton
      AND checkout_workers_drained AND evidence_reference=p_attestation_id::text)
      OR NOT EXISTS(SELECT 1 FROM public.account_closure_tokens WHERE user_id=p_user_id
        AND request_id=p_request_id AND phase='processing')
      OR NOT EXISTS(SELECT 1 FROM public.account_billing_fences WHERE user_id=p_user_id
        AND request_id=p_request_id AND phase='closing')
      THEN RAISE EXCEPTION 'active closure authority missing'; END IF;
  END IF;
  RETURN a;
END;
$$;

-- Email issuance and known-checkout reconciliation are also consuming writes.
-- Keep them on current authority rather than the legacy sticky rollout boolean.
CREATE FUNCTION public.issue_account_closure_token_with_drain(
  p_user_id uuid,p_token_hash text,p_attestation_id uuid,p_generation bigint,p_binding_digest text,p_context jsonb)
RETURNS TABLE(request_id uuid,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM 1 FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account profile unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  PERFORM public.require_account_closure_drain(p_attestation_id,p_generation,p_binding_digest,p_context);
  IF NOT EXISTS(SELECT 1 FROM public.account_billing_coordination WHERE singleton
    AND checkout_workers_drained AND evidence_reference=p_attestation_id::text)
    THEN RAISE EXCEPTION 'deletion not enabled for this attestation'; END IF;
  RETURN QUERY SELECT * FROM public.issue_account_closure_token(p_user_id,p_token_hash);
  PERFORM public.require_account_closure_drain(p_attestation_id,p_generation,p_binding_digest,p_context);
END;
$$;

CREATE FUNCTION public.reconcile_account_closure_checkout_with_drain(
  p_user_id uuid,p_token_hash text,p_operation_id uuid,p_session_id text,p_customer_id text,p_subscription_id text,
  p_attestation_id uuid,p_generation bigint,p_binding_digest text,p_context jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE token_expires timestamptz;
BEGIN
  PERFORM 1 FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account profile unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  PERFORM public.require_account_closure_drain(p_attestation_id,p_generation,p_binding_digest,p_context);
  IF NOT EXISTS(SELECT 1 FROM public.account_billing_coordination WHERE singleton
    AND checkout_workers_drained AND evidence_reference=p_attestation_id::text)
    THEN RAISE EXCEPTION 'deletion not enabled for this attestation'; END IF;
  SELECT t.expires_at INTO token_expires FROM public.account_closure_tokens t JOIN auth.users u ON u.id=t.user_id
    WHERE t.user_id=p_user_id AND t.token_hash=p_token_hash AND t.phase='issued' AND t.consumed_at IS NULL
      AND u.email_confirmed_at IS NOT NULL AND lower(btrim(u.email))=t.email_normalized FOR UPDATE OF t;
  IF NOT FOUND OR token_expires<=clock_timestamp() THEN RAISE EXCEPTION 'closure token expired'; END IF;
  IF p_operation_id IS NULL OR nullif(btrim(p_session_id),'') IS NULL THEN RAISE EXCEPTION 'checkout ownership mismatch'; END IF;
  IF p_customer_id IS NULL AND p_subscription_id IS NULL THEN
    PERFORM public.reconcile_expired_account_checkout(p_user_id,p_token_hash,p_operation_id,p_session_id);
  ELSIF nullif(btrim(p_customer_id),'') IS NOT NULL AND nullif(btrim(p_subscription_id),'') IS NOT NULL THEN
    PERFORM public.settle_account_checkout(p_user_id,p_session_id,p_customer_id,p_subscription_id,p_operation_id);
  ELSE RAISE EXCEPTION 'checkout ownership mismatch'; END IF;
  PERFORM public.require_account_closure_drain(p_attestation_id,p_generation,p_binding_digest,p_context);
  IF token_expires<=clock_timestamp() THEN RAISE EXCEPTION 'closure token expired'; END IF;
END;
$$;

CREATE FUNCTION public.claim_account_closure_token_with_drain(
  p_user_id uuid,p_token_hash text,p_attestation_id uuid,p_generation bigint,p_binding_digest text,p_context jsonb)
RETURNS TABLE(user_id uuid,email text,customer_id text,request_id uuid,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE proof record;
BEGIN
  PERFORM 1 FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account profile unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  PERFORM public.require_account_closure_drain(p_attestation_id,p_generation,p_binding_digest,p_context);
  IF NOT EXISTS(SELECT 1 FROM public.account_billing_coordination WHERE singleton
    AND checkout_workers_drained AND evidence_reference=p_attestation_id::text)
    THEN RAISE EXCEPTION 'deletion not enabled for this attestation'; END IF;
  PERFORM 1 FROM public.account_closure_tokens t WHERE t.user_id=p_user_id AND t.token_hash=p_token_hash FOR UPDATE;
  PERFORM public.require_account_closure_drain(p_attestation_id,p_generation,p_binding_digest,p_context);
  IF NOT EXISTS(SELECT 1 FROM public.account_closure_tokens t WHERE t.user_id=p_user_id AND t.token_hash=p_token_hash
    AND t.phase='issued' AND t.consumed_at IS NULL AND t.expires_at>clock_timestamp()) THEN RETURN; END IF;
  FOR proof IN SELECT * FROM public.claim_account_closure_token(p_user_id,p_token_hash) LOOP
    UPDATE public.account_closure_attempts a SET drain_attestation_id=p_attestation_id,drain_generation=p_generation,
      drain_binding_digest=p_binding_digest,drain_context=p_context
      WHERE a.user_id=p_user_id AND a.request_id=proof.request_id AND a.phase='processing';
    IF NOT FOUND THEN RAISE EXCEPTION 'closure claim binding missing'; END IF;
    -- The legacy fence/journal UPSERTs may have waited after the prechecks.
    -- Refuse in this transaction so neither the claim nor its binding escapes.
    PERFORM public.require_account_closure_drain(p_attestation_id,p_generation,p_binding_digest,p_context);
    IF proof.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'closure token expired'; END IF;
    RETURN QUERY SELECT proof.user_id,proof.email,proof.customer_id,proof.request_id,proof.expires_at;
  END LOOP;
END;
$$;

CREATE FUNCTION public.inspect_account_closure_authority(
  p_user_id uuid,p_request_id uuid,p_attestation_id uuid,p_generation bigint,p_binding_digest text,p_context jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.account_closure_attempts; d public.account_closure_drain_attestations;
BEGIN
  a:=public.require_account_closure_request_authority(p_user_id,p_request_id,p_attestation_id,p_generation,p_binding_digest,p_context);
  d:=public.require_account_closure_drain(p_attestation_id,p_generation,p_binding_digest,p_context);
  RETURN jsonb_build_object('attempt',jsonb_build_object('userId',a.user_id,'requestId',a.request_id,'email',a.claimed_email,'phase',a.phase),
    'authority',jsonb_build_object('userId',a.user_id,'requestId',a.request_id,'generation',d.generation::text,
      'bindingDigest',d.binding_digest,'validFrom',extract(epoch FROM (d.record->>'createdAt')::timestamptz)*1000,
      'expiresAt',extract(epoch FROM d.expires_at)*1000));
END;
$$;

-- A disabled rollout may still reconcile an irreversible operation's unknown
-- outcome. Rebinding grants ONLY recovery of the same post-Auth journal, never
-- a new claim, provider delete or a return to processing. The original claimed
-- user/request/email remain immutable. No historical processing request is adopted.
CREATE FUNCTION public.bind_account_closure_recovery_authority(
  p_user_id uuid,p_request_id uuid,p_attestation_id uuid,p_generation bigint,p_binding_digest text,p_context jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  PERFORM public.require_account_closure_drain(p_attestation_id,p_generation,p_binding_digest,p_context);
  PERFORM 1 FROM public.account_closure_attempts WHERE user_id=p_user_id AND request_id=p_request_id
    AND phase IN ('auth_unknown','auth_deleted','completed') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'recovery request unavailable'; END IF;
  PERFORM public.require_account_closure_drain(p_attestation_id,p_generation,p_binding_digest,p_context);
  UPDATE public.account_closure_attempts SET drain_attestation_id=p_attestation_id,drain_generation=p_generation,
    drain_binding_digest=p_binding_digest,drain_context=p_context WHERE user_id=p_user_id AND request_id=p_request_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.record_account_closure_auth_state_with_drain(
  p_user_id uuid,p_request_id uuid,p_state text,p_attestation_id uuid,p_generation bigint,p_binding_digest text,p_context jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.require_account_closure_request_authority(p_user_id,p_request_id,p_attestation_id,p_generation,p_binding_digest,p_context);
  -- Existing authoritative transitions independently enforce Auth absence,
  -- owned-fence cleanup, complete residue and exact phase compare-and-set.
  PERFORM public.record_account_closure_auth_state(p_user_id,p_request_id,p_state);
  -- Auth-absent cleanup can block on a downstream fence/checkout row. Recheck
  -- the actual clock after it, rolling back phase and cleanup together on expiry.
  PERFORM public.require_account_closure_drain(p_attestation_id,p_generation,p_binding_digest,p_context);
END;
$$;

CREATE FUNCTION public.settle_account_closure_billing_with_drain(
  p_user_id uuid,p_request_id uuid,p_customer_id text,p_subscriptions jsonb,
  p_attestation_id uuid,p_generation bigint,p_binding_digest text,p_context jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  -- Preserve profile→billing advisory ordering before taking global drain locks.
  PERFORM 1 FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'billing identity mismatch'; END IF;
  PERFORM public.require_account_closure_request_authority(p_user_id,p_request_id,p_attestation_id,p_generation,p_binding_digest,p_context);
  PERFORM public.settle_account_closure_billing(p_user_id,p_request_id,p_customer_id,p_subscriptions);
  -- The delegated token/fence locks and tombstone uniqueness waits are later
  -- consuming boundaries than the request precheck; rollback on expired drain.
  PERFORM public.require_account_closure_drain(p_attestation_id,p_generation,p_binding_digest,p_context);
END;
$$;

CREATE FUNCTION public.verify_account_closure_residue_with_drain(
  p_user_id uuid,p_request_id uuid,p_attestation_id uuid,p_generation bigint,p_binding_digest text,p_context jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.account_closure_attempts;
BEGIN
  a:=public.require_account_closure_request_authority(p_user_id,p_request_id,p_attestation_id,p_generation,p_binding_digest,p_context);
  IF a.phase NOT IN ('auth_deleted','completed') THEN RETURN false; END IF;
  RETURN public.verify_account_closure_residue(p_user_id,a.claimed_email);
END;
$$;

-- Read-only opaque generation for the private deployment controller. No raw
-- attestation, user journal or broad table grant is exposed.
CREATE FUNCTION public.inspect_account_closure_drain_generation()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_generation bigint;
BEGIN
  SELECT generation INTO STRICT current_generation FROM public.account_closure_attestation_state WHERE singleton;
  RETURN current_generation::text;
END;
$$;

-- Legacy bodies remain internal building blocks, not service-role bypasses.
REVOKE ALL ON FUNCTION public.claim_account_closure_token(uuid,text),
  public.issue_account_closure_token(uuid,text),
  public.reconcile_expired_account_checkout(uuid,text,uuid,text),
  public.record_account_closure_auth_state(uuid,uuid,text),
  public.settle_account_closure_billing(uuid,uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.require_account_closure_drain(uuid,bigint,text,jsonb),
  public.require_account_closure_request_authority(uuid,uuid,uuid,bigint,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.claim_account_closure_token_with_drain(uuid,text,uuid,bigint,text,jsonb),
  public.inspect_account_closure_drain_generation(),
  public.issue_account_closure_token_with_drain(uuid,text,uuid,bigint,text,jsonb),
  public.reconcile_account_closure_checkout_with_drain(uuid,text,uuid,text,text,text,uuid,bigint,text,jsonb),
  public.inspect_account_closure_authority(uuid,uuid,uuid,bigint,text,jsonb),
  public.bind_account_closure_recovery_authority(uuid,uuid,uuid,bigint,text,jsonb),
  public.record_account_closure_auth_state_with_drain(uuid,uuid,text,uuid,bigint,text,jsonb),
  public.settle_account_closure_billing_with_drain(uuid,uuid,text,jsonb,uuid,bigint,text,jsonb),
  public.verify_account_closure_residue_with_drain(uuid,uuid,uuid,bigint,text,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_account_closure_token_with_drain(uuid,text,uuid,bigint,text,jsonb),
  public.inspect_account_closure_drain_generation(),
  public.issue_account_closure_token_with_drain(uuid,text,uuid,bigint,text,jsonb),
  public.reconcile_account_closure_checkout_with_drain(uuid,text,uuid,text,text,text,uuid,bigint,text,jsonb),
  public.inspect_account_closure_authority(uuid,uuid,uuid,bigint,text,jsonb),
  public.bind_account_closure_recovery_authority(uuid,uuid,uuid,bigint,text,jsonb),
  public.record_account_closure_auth_state_with_drain(uuid,uuid,text,uuid,bigint,text,jsonb),
  public.settle_account_closure_billing_with_drain(uuid,uuid,text,jsonb,uuid,bigint,text,jsonb),
  public.verify_account_closure_residue_with_drain(uuid,uuid,uuid,bigint,text,jsonb)
  TO service_role;
COMMIT;
