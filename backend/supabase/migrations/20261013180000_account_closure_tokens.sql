-- Source preparation only. No automatic application/retrospective deletion.
BEGIN;

CREATE TABLE public.account_closure_tokens (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  email_normalized text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT statement_timestamp() + interval '15 minutes',
  consumed_at timestamptz,
  phase text NOT NULL DEFAULT 'issued' CHECK (phase IN ('issued', 'processing', 'failed'))
);
ALTER TABLE public.account_closure_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_closure_tokens FROM PUBLIC, anon, authenticated, service_role;

-- Deliberately no FK to auth.users: irreversible-operation uncertainty must survive
-- auth cascade. Client roles cannot read, reset, expire or manufacture this journal.
CREATE TABLE public.account_closure_attempts (
  user_id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  phase text NOT NULL CHECK (phase IN ('processing', 'auth_unknown', 'auth_deleted', 'completed', 'failed')),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE public.account_closure_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_closure_attempts FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.account_billing_fences (
  user_id uuid PRIMARY KEY,
  phase text NOT NULL DEFAULT 'open' CHECK(phase IN ('open','closing')),
  request_id uuid
);
CREATE TABLE public.account_checkout_operations (
  operation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id text UNIQUE,
  phase text NOT NULL DEFAULT 'issuing' CHECK(phase IN ('issuing','open','settled','unknown')),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
-- Rollout prerequisite: old unfenced checkout workers must be drained before an
-- operator enables deletion. A source test or new route alone cannot certify that.
CREATE TABLE public.account_billing_coordination (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  checkout_workers_drained boolean NOT NULL DEFAULT false,
  evidence_reference text
);
INSERT INTO public.account_billing_coordination(singleton) VALUES(true);
CREATE TABLE public.account_closure_billing_permits (
  user_id uuid PRIMARY KEY, request_id uuid NOT NULL, transaction_id bigint NOT NULL
);
ALTER TABLE public.account_billing_fences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_checkout_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_billing_coordination ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_closure_billing_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_billing_fences,public.account_checkout_operations,
  public.account_billing_coordination,public.account_closure_billing_permits
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.begin_account_checkout(p_user_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_operation uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id) THEN RAISE EXCEPTION 'account unavailable'; END IF;
  INSERT INTO public.account_billing_fences(user_id) VALUES(p_user_id) ON CONFLICT DO NOTHING;
  IF EXISTS(SELECT 1 FROM public.account_billing_fences WHERE user_id=p_user_id AND phase='closing')
    OR EXISTS(SELECT 1 FROM public.account_closure_attempts WHERE user_id=p_user_id AND phase<>'failed')
    OR EXISTS(SELECT 1 FROM public.account_checkout_operations WHERE user_id=p_user_id AND phase<>'settled')
    THEN RAISE EXCEPTION 'billing operation pending'; END IF;
  INSERT INTO public.account_checkout_operations(user_id) VALUES(p_user_id) RETURNING operation_id INTO v_operation;
  RETURN v_operation;
END;
$$;

CREATE FUNCTION public.record_account_checkout(p_user_id uuid,p_operation_id uuid,p_session_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  IF NULLIF(btrim(p_session_id),'') IS NULL THEN RAISE EXCEPTION 'session identity missing'; END IF;
  UPDATE public.account_checkout_operations SET session_id=p_session_id,phase='open'
    WHERE user_id=p_user_id AND operation_id=p_operation_id AND phase='issuing';
  IF NOT FOUND AND EXISTS(SELECT 1 FROM public.account_checkout_operations WHERE user_id=p_user_id
    AND operation_id=p_operation_id AND session_id=p_session_id AND phase='settled') THEN RETURN; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'checkout ownership mismatch'; END IF;
END;
$$;

-- Called only after authenticated Stripe completion has applied its canonical
-- subscription snapshot. Open/issuing operations never disappear on timeout.
CREATE FUNCTION public.settle_account_checkout(p_user_id uuid,p_session_id text,p_customer_id text,p_subscription_id text,
  p_operation_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  IF EXISTS(SELECT 1 FROM public.account_billing_fences WHERE user_id=p_user_id AND phase='closing')
    THEN RAISE EXCEPTION 'account closure pending'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE id=p_user_id AND stripe_customer_id=p_customer_id
    AND stripe_subscription_id=p_subscription_id) THEN RAISE EXCEPTION 'checkout not attached'; END IF;
  IF p_operation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.account_checkout_operations
    WHERE user_id=p_user_id AND operation_id=p_operation_id AND
      (session_id=p_session_id OR (session_id IS NULL AND phase='issuing')))
    THEN RAISE EXCEPTION 'checkout ownership mismatch'; END IF;
  UPDATE public.account_checkout_operations SET phase='settled',session_id=p_session_id
    WHERE user_id=p_user_id AND ((session_id=p_session_id AND phase='open')
      OR (operation_id=p_operation_id AND phase='issuing' AND session_id IS NULL));
  -- Legacy completions have no operation row; the verified profile binding above
  -- remains authoritative and the closure adapter separately scans legacy sessions.
END;
$$;

CREATE FUNCTION public.inspect_account_closure_checkouts(p_user_id uuid,p_token_hash text)
RETURNS TABLE(operation_id uuid,session_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.account_closure_tokens t JOIN auth.users u ON u.id=t.user_id
    WHERE t.user_id=p_user_id AND t.token_hash=p_token_hash AND t.phase='issued'
      AND t.expires_at>statement_timestamp() AND lower(btrim(u.email))=t.email_normalized
      AND u.email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'verification unavailable'; END IF;
  RETURN QUERY SELECT o.operation_id,o.session_id FROM public.account_checkout_operations o
    WHERE o.user_id=p_user_id AND o.phase<>'settled';
END;
$$;

-- Only the provider adapter may supply an authenticated, exact-session expired
-- readback. Local time alone never expires an issuing/open/unknown operation.
CREATE FUNCTION public.reconcile_expired_account_checkout(p_user_id uuid,p_token_hash text,p_operation_id uuid,p_session_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  IF NOT EXISTS(SELECT 1 FROM public.account_closure_tokens WHERE user_id=p_user_id
    AND token_hash=p_token_hash AND phase='issued' AND expires_at>statement_timestamp())
    OR EXISTS(SELECT 1 FROM public.account_billing_fences WHERE user_id=p_user_id AND phase='closing')
    THEN RAISE EXCEPTION 'reconciliation ownership missing'; END IF;
  UPDATE public.account_checkout_operations SET phase='settled'
    WHERE user_id=p_user_id AND operation_id=p_operation_id AND session_id=p_session_id AND phase='open';
  IF NOT FOUND THEN RAISE EXCEPTION 'checkout ownership mismatch'; END IF;
END;
$$;

CREATE FUNCTION public.guard_account_closure_billing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||NEW.id::text,0));
  IF TG_OP='UPDATE' AND
    (NEW.stripe_customer_id,NEW.stripe_subscription_id,NEW.subscription_id,NEW.subscription_status)
      IS NOT DISTINCT FROM (OLD.stripe_customer_id,OLD.stripe_subscription_id,OLD.subscription_id,OLD.subscription_status)
    THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM public.account_billing_fences WHERE user_id=NEW.id AND phase='closing') THEN
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
CREATE TRIGGER account_closure_billing_guard BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_closure_billing();
REVOKE EXECUTE ON FUNCTION public.guard_account_closure_billing() FROM PUBLIC,anon,authenticated,service_role;

-- D1: the retained ledger must govern signup, not merely survive deletion. The previous
-- 30-day trigger stamped a new window without consulting this ledger.
CREATE OR REPLACE FUNCTION public.ensure_trial_profile_for_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_email text := lower(btrim(NEW.email)); v_started timestamptz; v_expires timestamptz;
BEGIN
  IF v_email IS NULL OR v_email = '' THEN RETURN NEW; END IF;
  INSERT INTO public.trial_entitlements(email, user_id, trial_started_at, trial_expires_at)
    VALUES (v_email, NEW.id, now(), now() + interval '30 days')
    ON CONFLICT (email) DO UPDATE SET
      user_id = COALESCE(public.trial_entitlements.user_id, EXCLUDED.user_id), updated_at = now()
    RETURNING trial_started_at, trial_expires_at INTO v_started, v_expires;
  INSERT INTO public.user_profiles(id, subscription_status, private_sample_limit_seconds,
    private_sample_seconds_used, trial_started_at, trial_expires_at, commercial_trial_granted_at)
    VALUES (NEW.id, 'free', 300, 0, v_started, v_expires, v_started)
    ON CONFLICT (id) DO UPDATE SET
      subscription_status = CASE WHEN lower(COALESCE(public.user_profiles.subscription_status, 'free')) = 'pro'
        AND NULLIF(btrim(COALESCE(public.user_profiles.stripe_subscription_id, '')), '') IS NOT NULL
        THEN public.user_profiles.subscription_status ELSE 'free' END,
      private_sample_limit_seconds = COALESCE(public.user_profiles.private_sample_limit_seconds, 300),
      private_sample_seconds_used = COALESCE(public.user_profiles.private_sample_seconds_used, 0),
      trial_started_at = v_started, trial_expires_at = v_expires,
      commercial_trial_granted_at = COALESCE(public.user_profiles.commercial_trial_granted_at, v_started),
      updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ensure_trial_profile_for_new_user() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.issue_account_closure_token(p_user_id uuid, p_token_hash text)
RETURNS TABLE(request_id uuid, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_email text; v_now timestamptz := statement_timestamp();
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid token hash';
  END IF;
  SELECT lower(btrim(email)) INTO v_email FROM auth.users
    WHERE id = p_user_id AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL OR v_email = '' THEN RAISE EXCEPTION 'confirmed email required'; END IF;
  IF EXISTS (SELECT 1 FROM public.account_closure_attempts a WHERE a.user_id=p_user_id AND a.phase <> 'failed')
    THEN RETURN; END IF;
  RETURN QUERY INSERT INTO public.account_closure_tokens AS t
    (user_id, token_hash, email_normalized, issued_at, expires_at)
    VALUES (p_user_id, p_token_hash, v_email, v_now, v_now + interval '15 minutes')
    ON CONFLICT (user_id) DO UPDATE SET
      request_id = gen_random_uuid(), token_hash = EXCLUDED.token_hash,
      email_normalized = EXCLUDED.email_normalized, issued_at = EXCLUDED.issued_at,
      expires_at = EXCLUDED.expires_at, consumed_at = NULL, phase = 'issued'
    WHERE t.phase <> 'processing' AND t.issued_at <= v_now - interval '60 seconds'
    RETURNING t.request_id, t.expires_at;
END;
$$;

CREATE FUNCTION public.revoke_account_closure_token(p_user_id uuid, p_token_hash text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM public.account_closure_tokens
   WHERE user_id = p_user_id AND token_hash = p_token_hash AND phase = 'issued';
$$;

CREATE FUNCTION public.claim_account_closure_token(p_user_id uuid, p_token_hash text)
RETURNS TABLE(user_id uuid, email text, customer_id text, request_id uuid, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.account_closure_tokens%ROWTYPE; v_customer text; v_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  SELECT t.* INTO v_row FROM public.account_closure_tokens t
    JOIN auth.users u ON u.id = t.user_id
    WHERE t.user_id = p_user_id AND t.token_hash = p_token_hash
      AND t.phase = 'issued' AND t.consumed_at IS NULL
      AND t.expires_at > statement_timestamp() AND u.email_confirmed_at IS NOT NULL
      AND lower(btrim(u.email)) = t.email_normalized
    FOR UPDATE OF t;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.account_closure_attempts a WHERE a.user_id=p_user_id AND a.phase <> 'failed')
    THEN RETURN; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.account_billing_coordination WHERE checkout_workers_drained
      AND NULLIF(btrim(evidence_reference),'') IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.account_checkout_operations o WHERE o.user_id=p_user_id AND o.phase<>'settled')
    THEN RAISE EXCEPTION 'checkout reconciliation required'; END IF;
  INSERT INTO public.account_billing_fences(user_id,phase,request_id) VALUES(p_user_id,'closing',v_row.request_id)
    ON CONFLICT ON CONSTRAINT account_billing_fences_pkey DO UPDATE SET phase='closing',request_id=EXCLUDED.request_id;
  SELECT p.stripe_customer_id, p.subscription_status INTO v_customer, v_status
    FROM public.user_profiles p WHERE p.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account profile unavailable'; END IF;
  IF v_status = 'pro' AND (v_customer IS NULL OR btrim(v_customer) = '') THEN
    RAISE EXCEPTION 'paid billing identity unavailable';
  END IF;
  UPDATE public.account_closure_tokens t SET consumed_at = statement_timestamp(), phase = 'processing'
    WHERE t.user_id = p_user_id AND t.request_id = v_row.request_id;
  INSERT INTO public.account_closure_attempts(user_id,request_id,phase)
    VALUES(p_user_id,v_row.request_id,'processing') ON CONFLICT ON CONSTRAINT account_closure_attempts_pkey DO UPDATE
    SET request_id=EXCLUDED.request_id,phase='processing',updated_at=statement_timestamp()
    WHERE account_closure_attempts.phase='failed';
  RETURN QUERY SELECT v_row.user_id, v_row.email_normalized, v_customer,
    v_row.request_id, v_row.expires_at;
END;
$$;

-- A completed failed HTTP attempt releases its processing hold, NOT the consumed token.
-- Interrupted/unknown attempts stay processing until independently reconciled; no unsafe expiry retry.
CREATE FUNCTION public.finish_account_closure_attempt(p_user_id uuid, p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  UPDATE public.account_closure_attempts SET phase='failed',updated_at=statement_timestamp()
    WHERE user_id=p_user_id AND request_id=p_request_id AND phase='processing';
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.account_closure_tokens SET phase = 'failed'
    WHERE user_id = p_user_id AND request_id = p_request_id AND phase = 'processing';
  UPDATE public.account_billing_fences SET phase='open',request_id=NULL
    WHERE user_id=p_user_id AND request_id=p_request_id;
END;
$$;

CREATE FUNCTION public.record_account_closure_auth_state(p_user_id uuid,p_request_id uuid,p_state text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.account_closure_attempts SET phase=p_state,updated_at=statement_timestamp()
    WHERE user_id=p_user_id AND request_id=p_request_id AND
      ((p_state='auth_unknown' AND phase='processing') OR
       (p_state='auth_deleted' AND phase='auth_unknown') OR
       (p_state='completed' AND phase='auth_deleted'));
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid closure transition'; END IF;
END;
$$;

CREATE FUNCTION public.preserve_account_trial_email(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_email text; v_owner uuid;
BEGIN
  SELECT lower(btrim(email)) INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL OR v_email = '' THEN RAISE EXCEPTION 'email unavailable'; END IF;
  INSERT INTO public.trial_entitlements(email, user_id, trial_started_at, trial_expires_at)
    VALUES (v_email, p_user_id, now(), now()) ON CONFLICT (email) DO NOTHING;
  SELECT user_id INTO v_owner FROM public.trial_entitlements WHERE email = v_email FOR UPDATE;
  IF v_owner IS NOT NULL AND v_owner <> p_user_id THEN RAISE EXCEPTION 'trial identity conflict'; END IF;
END;
$$;

CREATE FUNCTION public.settle_account_closure_billing(
  p_user_id uuid, p_request_id uuid, p_customer_id text, p_subscriptions jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_sub jsonb; v_bound text; v_customer text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.account_closure_tokens WHERE user_id = p_user_id
    AND request_id = p_request_id AND phase = 'processing') THEN RAISE EXCEPTION 'closure not claimed'; END IF;
  SELECT stripe_subscription_id, stripe_customer_id INTO v_bound, v_customer
    FROM public.user_profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_customer IS DISTINCT FROM p_customer_id OR p_customer_id IS NULL THEN
    RAISE EXCEPTION 'billing identity mismatch';
  END IF;
  IF jsonb_typeof(p_subscriptions) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'complete snapshot required'; END IF;
  IF v_bound IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_subscriptions) s
    WHERE s->>'id' = v_bound) THEN RAISE EXCEPTION 'bound subscription missing'; END IF;
  FOR v_sub IN SELECT value FROM jsonb_array_elements(p_subscriptions) LOOP
    IF coalesce(v_sub->>'id', '') = '' OR coalesce(v_sub->>'status', '') NOT IN ('canceled', 'incomplete_expired')
      THEN RAISE EXCEPTION 'nonterminal subscription'; END IF;
    IF EXISTS (SELECT 1 FROM public.user_profiles WHERE id <> p_user_id
      AND (stripe_subscription_id = v_sub->>'id' OR stripe_customer_id = p_customer_id))
      THEN RAISE EXCEPTION 'billing owner conflict'; END IF;
    IF EXISTS (SELECT 1 FROM public.stripe_subscription_tombstones WHERE subscription_id = v_sub->>'id'
      AND customer_id <> p_customer_id) THEN RAISE EXCEPTION 'terminal identity conflict'; END IF;
    INSERT INTO public.stripe_subscription_tombstones(subscription_id, customer_id, terminal_status, event_id)
      VALUES (v_sub->>'id', p_customer_id, v_sub->>'status', 'account-closure:' || p_request_id)
      ON CONFLICT (subscription_id) DO NOTHING;
  END LOOP;
  INSERT INTO public.account_closure_billing_permits VALUES(p_user_id,p_request_id,txid_current());
  UPDATE public.user_profiles SET subscription_status = 'free', stripe_subscription_id = NULL,
    subscription_id = NULL, stripe_cancel_at_period_end = false, updated_at = now() WHERE id = p_user_id;
  DELETE FROM public.account_closure_billing_permits WHERE user_id=p_user_id AND request_id=p_request_id;
END;
$$;

CREATE FUNCTION public.verify_account_closure_residue(p_user_id uuid, p_email text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; v_count bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.list_account_closure_storage(p_user_id)) THEN RETURN false; END IF;
  -- Enumerate real referencing tables, including future migrations; unsupported composite FKs fail closed.
  FOR r IN SELECT c.conkey, c.confkey, n.nspname, t.relname, a.attname, target.attname AS target_column FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = c.conkey[1]
    JOIN pg_catalog.pg_attribute target ON target.attrelid = c.confrelid AND target.attnum = c.confkey[1]
    WHERE c.contype = 'f' AND c.confrelid = 'auth.users'::regclass LOOP
    IF cardinality(r.conkey) <> 1 OR cardinality(r.confkey) <> 1 OR r.target_column <> 'id'
      THEN RAISE EXCEPTION 'unsupported user reference'; END IF;
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = $1', r.nspname, r.relname, r.attname)
      INTO v_count USING p_user_id;
    IF v_count <> 0 THEN RETURN false; END IF;
  END LOOP;
  RETURN EXISTS (SELECT 1 FROM public.trial_entitlements
    WHERE email = lower(btrim(p_email)) AND user_id IS NULL);
END;
$$;

CREATE FUNCTION public.list_account_closure_storage(p_user_id uuid)
RETURNS TABLE(bucket_id text, name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_owner text; v_legacy boolean; v_modern boolean; v_conflict boolean;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN RETURN; END IF;
  SELECT a.attname INTO v_owner FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'storage.objects'::regclass AND a.attname IN ('owner_id', 'owner')
      AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY CASE WHEN a.attname = 'owner_id' THEN 0 ELSE 1 END LIMIT 1;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'storage owner schema unavailable'; END IF;
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='storage.objects'::regclass
    AND attname='owner' AND attnum>0 AND NOT attisdropped),
    EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='storage.objects'::regclass
    AND attname='owner_id' AND attnum>0 AND NOT attisdropped) INTO v_legacy, v_modern;
  IF v_legacy AND v_modern THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM storage.objects WHERE (owner::text=$1 OR owner_id::text=$1)
      AND owner IS NOT NULL AND nullif(owner_id::text, '''') IS NOT NULL AND owner::text<>owner_id::text)'
      INTO v_conflict USING p_user_id::text;
    IF v_conflict THEN RAISE EXCEPTION 'ambiguous storage ownership'; END IF;
    RETURN QUERY EXECUTE 'SELECT bucket_id::text, name::text FROM storage.objects
      WHERE owner::text=$1 OR owner_id::text=$1' USING p_user_id::text;
    RETURN;
  END IF;
  RETURN QUERY EXECUTE format('SELECT bucket_id::text, name::text FROM storage.objects WHERE %I::text = $1', v_owner)
    USING p_user_id::text;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_account_closure_token(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_account_checkout(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_account_checkout(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.record_account_checkout(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_account_checkout(uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.settle_account_checkout(uuid,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_account_checkout(uuid,text,text,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.inspect_account_closure_checkouts(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inspect_account_closure_checkouts(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.reconcile_expired_account_checkout(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_expired_account_checkout(uuid,text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_account_closure_token(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.revoke_account_closure_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_account_closure_token(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.claim_account_closure_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_account_closure_token(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.finish_account_closure_attempt(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_account_closure_attempt(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.record_account_closure_auth_state(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_account_closure_auth_state(uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.preserve_account_trial_email(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preserve_account_trial_email(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.settle_account_closure_billing(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_account_closure_billing(uuid, uuid, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.verify_account_closure_residue(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_account_closure_residue(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.list_account_closure_storage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_account_closure_storage(uuid) TO service_role;
COMMIT;
