BEGIN;
-- Persistence only: registration cannot enable deletion. Require the prior
-- schema and lock its disabled coordination row before adding this prerequisite.
DO $guard$
BEGIN
  PERFORM 1 FROM public.account_billing_coordination WHERE singleton
    AND NOT checkout_workers_drained AND evidence_reference IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'deletion must remain disabled before drain persistence apply'; END IF;
END;
$guard$;
CREATE TABLE public.account_closure_attestation_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  generation bigint NOT NULL DEFAULT 0 CHECK(generation>=0),
  binding_digest text CHECK(binding_digest ~ '^[a-f0-9]{64}$')
);
INSERT INTO public.account_closure_attestation_state(singleton) VALUES(true);
CREATE TABLE public.account_closure_drain_attestations (
  attestation_id uuid PRIMARY KEY,
  generation bigint NOT NULL,
  binding_digest text NOT NULL CHECK(binding_digest ~ '^[a-f0-9]{64}$'),
  evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),
  record jsonb NOT NULL,
  validation jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  invalidated_at timestamptz,
  invalidation_reason text,
  invalidation_evidence_digest text
);
ALTER TABLE public.account_closure_attestation_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_closure_drain_attestations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_closure_attestation_state, public.account_closure_drain_attestations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.record_account_closure_drain_attestation(
  p_attestation_id uuid, p_expected_generation bigint, p_record jsonb, p_validation jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE state public.account_closure_attestation_state; prior public.account_closure_drain_attestations;
  expiry timestamptz; created timestamptz; binding text; evidence text; registered_at timestamptz;
BEGIN
  -- Global order: disabled coordination row, then attestation generation row.
  PERFORM 1 FROM public.account_billing_coordination WHERE singleton AND NOT checkout_workers_drained
    AND evidence_reference IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'deletion must remain disabled'; END IF;
  SELECT * INTO STRICT state FROM public.account_closure_attestation_state WHERE singleton FOR UPDATE;
  -- statement_timestamp() predates lock waits. Capture the actual clock once
  -- after BOTH serialization locks, for freshness and registration provenance.
  registered_at:=clock_timestamp();
  IF p_expected_generation IS DISTINCT FROM state.generation THEN RAISE EXCEPTION 'stale attestation generation'; END IF;
  IF p_attestation_id IS NULL OR jsonb_typeof(p_record) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_record))<>15
    OR NOT p_record ?& ARRAY['version','candidateSha','mainSha','migrationDigest','target','deployments','configDigest',
      'payments','operatorId','createdAt','expiresAt','evidenceDigest','bindingDigest','legacyWriters','inventory']
    OR p_record->'version' IS DISTINCT FROM '1'::jsonb
    OR NOT coalesce(p_record->>'candidateSha' ~ '^[a-f0-9]{40}$',false) OR NOT coalesce(p_record->>'mainSha' ~ '^[a-f0-9]{40}$',false)
    OR NOT coalesce(p_record->>'migrationDigest' ~ '^[a-f0-9]{64}$',false) OR NOT coalesce(p_record->>'configDigest' ~ '^[a-f0-9]{64}$',false)
    THEN RAISE EXCEPTION 'invalid attestation record'; END IF;
  binding:=p_record->>'bindingDigest'; evidence:=p_record->>'evidenceDigest';
  IF binding IS NULL OR evidence IS NULL OR binding !~ '^[a-f0-9]{64}$' OR evidence !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(p_validation) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_validation))<>6
    OR NOT p_validation ?& ARRAY['version','validation','activationAuthorized','bindingDigest','evidenceDigest','quarantined']
    OR p_validation->>'validation' IS DISTINCT FROM 'OFFLINE_VALID'
    OR p_validation->'version' IS DISTINCT FROM '1'::jsonb
    OR p_validation->'activationAuthorized' IS DISTINCT FROM 'false'::jsonb
    OR p_validation->>'bindingDigest' IS DISTINCT FROM binding
    OR p_validation->>'evidenceDigest' IS DISTINCT FROM evidence
    OR jsonb_typeof(p_validation->'quarantined') IS DISTINCT FROM 'array'
    OR p_record->'payments'->'frontendEnabled' IS DISTINCT FROM 'false'::jsonb
    OR p_record->'payments'->'backendEnabled' IS DISTINCT FROM 'false'::jsonb
    THEN RAISE EXCEPTION 'validated service evidence required'; END IF;
  created:=(p_record->>'createdAt')::timestamptz; expiry:=(p_record->>'expiresAt')::timestamptz;
  IF created IS NULL OR expiry IS NULL OR created>registered_at OR expiry<=registered_at
    OR expiry<=created OR expiry-created>interval '15 minutes' THEN RAISE EXCEPTION 'stale attestation'; END IF;
  IF state.binding_digest IS NOT NULL AND state.binding_digest<>binding
    THEN RAISE EXCEPTION 'binding change requires invalidation'; END IF;
  SELECT * INTO prior FROM public.account_closure_drain_attestations WHERE attestation_id=p_attestation_id;
  IF FOUND THEN
    IF prior.generation=state.generation AND prior.record=p_record AND prior.validation=p_validation
      AND prior.invalidated_at IS NULL THEN RETURN prior.attestation_id; END IF;
    RAISE EXCEPTION 'attestation identity conflict';
  END IF;
  UPDATE public.account_closure_attestation_state SET binding_digest=binding WHERE singleton;
  INSERT INTO public.account_closure_drain_attestations(attestation_id,generation,binding_digest,evidence_digest,record,validation,expires_at,recorded_at)
    VALUES(p_attestation_id,state.generation,binding,evidence,p_record,p_validation,expiry,registered_at);
  RETURN p_attestation_id;
END;
$$;

CREATE FUNCTION public.invalidate_account_closure_drain_attestations(
  p_expected_generation bigint, p_reason text, p_evidence_digest text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE state public.account_closure_attestation_state;
BEGIN
  PERFORM 1 FROM public.account_billing_coordination WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'coordination state missing'; END IF;
  SELECT * INTO STRICT state FROM public.account_closure_attestation_state WHERE singleton FOR UPDATE;
  IF p_expected_generation IS DISTINCT FROM state.generation THEN RAISE EXCEPTION 'stale invalidation generation'; END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('rollback','deployment_changed','config_changed','uncertain_writer','expired')
    OR p_evidence_digest IS NULL OR p_evidence_digest !~ '^[a-f0-9]{64}$'
    THEN RAISE EXCEPTION 'invalidation evidence required'; END IF;
  UPDATE public.account_billing_coordination SET checkout_workers_drained=false,evidence_reference=NULL WHERE singleton;
  UPDATE public.account_closure_drain_attestations SET invalidated_at=statement_timestamp(),
    invalidation_reason=p_reason,invalidation_evidence_digest=p_evidence_digest WHERE invalidated_at IS NULL;
  UPDATE public.account_closure_attestation_state SET generation=generation+1,binding_digest=NULL WHERE singleton;
  RETURN state.generation+1;
END;
$$;
REVOKE ALL ON FUNCTION public.record_account_closure_drain_attestation(uuid,bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.invalidate_account_closure_drain_attestations(bigint,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_account_closure_drain_attestation(uuid,bigint,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.invalidate_account_closure_drain_attestations(bigint,text,text) TO service_role;
COMMIT;
