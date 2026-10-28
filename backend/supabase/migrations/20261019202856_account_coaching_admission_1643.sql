-- #1643: durable admission for fresh coaching and account-scoped settlement.
-- Requires the accepted #1658 pending account boundary; apply before activating this Edge caller.
-- No provider transaction is held open; admission commits before external work begins.
DO $$ BEGIN
  IF to_regprocedure('public.begin_account_closure_pending(uuid,text,boolean)') IS NULL
    OR to_regprocedure('public.persist_ai_suggestion_with_authority_v1(uuid,uuid,jsonb,text,text,text,date,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'pending and coaching authority predecessors required';
  END IF;
END $$;

CREATE TABLE public.account_coaching_operations (
  operation_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  phase text NOT NULL DEFAULT 'admitted' CHECK (phase IN ('admitted','completed','refused','unknown')),
  suggestion_sha256 text CHECK (suggestion_sha256 ~ '^[a-f0-9]{64}$'),
  completion_sha256 text CHECK (completion_sha256 ~ '^[a-f0-9]{64}$'),
  admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (phase <> 'completed' OR suggestion_sha256 IS NOT NULL)
);
-- The full index also bounds Auth FK checks after operations become terminal.
CREATE INDEX account_coaching_by_user ON public.account_coaching_operations(user_id);
CREATE INDEX account_coaching_unsettled_by_user ON public.account_coaching_operations(user_id)
  WHERE phase IN ('admitted','unknown');
ALTER TABLE public.account_coaching_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_coaching_operations FROM PUBLIC,anon,authenticated,service_role;
-- Definer-owned table access is intentional; only the reviewed service-role RPCs below are exposed.
-- Existing authorized Auth deletion may cascade terminal rows. Unsettled rows abort the
-- ENTIRE parent statement; skipping a child would leave an unsafe partial account deletion.
CREATE FUNCTION public.guard_unsettled_account_coaching_delete_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF OLD.phase NOT IN ('completed','refused') THEN
    RAISE EXCEPTION 'account coaching operation unsettled' USING ERRCODE='55000';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_unsettled_account_coaching_delete_v1()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_unsettled_account_coaching_delete
  BEFORE DELETE ON public.account_coaching_operations
  FOR EACH ROW EXECUTE FUNCTION public.guard_unsettled_account_coaching_delete_v1();

CREATE FUNCTION public.begin_account_coaching_v1(p_user_id uuid,p_session_id uuid,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_user_id IS NULL OR p_session_id IS NULL OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'coaching identity required' USING ERRCODE='22023';
  END IF;
  -- Match the accepted pending/recording/checkout order: profile, account, then operation/session.
  PERFORM 1 FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('admitted',false,'reason','account_unavailable'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  IF EXISTS(SELECT 1 FROM public.account_billing_fences WHERE user_id=p_user_id AND phase<>'open')
    OR EXISTS(SELECT 1 FROM public.account_closure_attempts WHERE user_id=p_user_id AND phase<>'failed') THEN
    RETURN jsonb_build_object('admitted',false,'reason','account_closure_pending');
  END IF;
  IF EXISTS(SELECT 1 FROM public.account_coaching_operations WHERE operation_id=p_operation_id) THEN
    RETURN jsonb_build_object('admitted',false,'reason','operation_already_recorded');
  END IF;
  PERFORM 1 FROM public.sessions WHERE id=p_session_id AND user_id=p_user_id FOR KEY SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('admitted',false,'reason','session_unavailable'); END IF;
  INSERT INTO public.account_coaching_operations(operation_id,user_id,session_id)
    VALUES(p_operation_id,p_user_id,p_session_id);
  RETURN jsonb_build_object('admitted',true,'operationId',p_operation_id);
END;
$$;

CREATE FUNCTION public.finish_account_coaching_failure_v1(
  p_user_id uuid,p_session_id uuid,p_operation_id uuid,p_outcome text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.account_coaching_operations;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('refused','unknown') THEN
    RAISE EXCEPTION 'invalid coaching failure outcome' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.user_profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  SELECT * INTO op FROM public.account_coaching_operations WHERE operation_id=p_operation_id
    AND user_id=p_user_id AND session_id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF op.phase<>'admitted' THEN RETURN op.phase=p_outcome; END IF;
  UPDATE public.account_coaching_operations SET phase=p_outcome,updated_at=clock_timestamp()
    WHERE operation_id=op.operation_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.persist_account_coaching_v1(
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

REVOKE ALL ON FUNCTION public.begin_account_coaching_v1(uuid,uuid,uuid),
  public.finish_account_coaching_failure_v1(uuid,uuid,uuid,text),
  public.persist_account_coaching_v1(uuid,boolean,uuid,uuid,jsonb,text,text,text,date,integer,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_account_coaching_v1(uuid,uuid,uuid),
  public.finish_account_coaching_failure_v1(uuid,uuid,uuid,text),
  public.persist_account_coaching_v1(uuid,boolean,uuid,uuid,jsonb,text,text,text,date,integer,integer)
  TO service_role;
-- No expiry-to-settled, account reopening, destructive permit, or cleanup function is introduced.
