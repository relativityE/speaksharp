-- Check admission only; serving never uses these fields to refuse coaching.
ALTER TABLE public.coaching_model_selection
  ADD COLUMN user_check_interval_seconds integer NOT NULL DEFAULT 3600 CHECK (user_check_interval_seconds BETWEEN 60 AND 86400),
  ADD COLUMN user_next_check_at timestamptz NOT NULL DEFAULT '-infinity',
  ADD COLUMN provider_check_after timestamptz NOT NULL DEFAULT '-infinity',
  ADD COLUMN user_retry_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN probe_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN probe_is_extra_attempt boolean NOT NULL DEFAULT false,
  ADD COLUMN last_check_at timestamptz,
  ADD COLUMN last_check_id uuid,
  ADD COLUMN last_check_outcome text CHECK (last_check_outcome IN ('healthy','promoted','unavailable','inconclusive','provider_limited','cancelled'));

CREATE FUNCTION public.claim_coaching_model_probe_v2(p_incumbent text, p_admin boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  selected public.coaching_model_selection%ROWTYPE;
  at_time timestamptz;
  token_id uuid;
  deadline_at timestamptz;
  state_value jsonb;
BEGIN
  IF p_admin IS NULL OR p_incumbent IS NULL OR p_incumbent !~ '^gemini-[a-z0-9][a-z0-9.-]{0,58}$' THEN RETURN NULL; END IF;
  INSERT INTO public.coaching_model_selection (model) VALUES (p_incumbent) ON CONFLICT (single) DO NOTHING;
  SELECT * INTO selected FROM public.coaching_model_selection WHERE single FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  at_time := pg_catalog.clock_timestamp();
  state_value := pg_catalog.jsonb_build_object('model', selected.model, 'revision', selected.revision);
  IF selected.probe_deadline > at_time THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'busy', 'state', state_value, 'checkId', selected.probe_token);
  END IF;
  IF NOT p_admin AND (selected.provider_check_after > at_time OR selected.user_next_check_at > at_time) THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'cooldown', 'state', state_value);
  END IF;
  token_id := pg_catalog.gen_random_uuid();
  deadline_at := at_time + interval '30 seconds';
  UPDATE public.coaching_model_selection
    SET probe_token = token_id, probe_deadline = deadline_at, probe_admin = p_admin,
        -- Reserve the interval at claim so a crashed next-Start attempt cannot retry forever.
        user_next_check_at = CASE WHEN p_admin THEN user_next_check_at
          ELSE at_time + pg_catalog.make_interval(secs => user_check_interval_seconds) END,
        probe_is_extra_attempt = NOT p_admin AND selected.user_retry_pending,
        user_retry_pending = CASE WHEN p_admin THEN user_retry_pending ELSE false END
    WHERE single;
  RETURN pg_catalog.jsonb_build_object('kind', 'claimed', 'lease', pg_catalog.jsonb_build_object(
    'state', state_value, 'token', token_id, 'deadlineMs', pg_catalog.floor(EXTRACT(EPOCH FROM deadline_at) * 1000)));
END;
$$;

CREATE FUNCTION public.finish_coaching_model_probe_v2(
  p_revision integer, p_token uuid, p_verified boolean, p_promote_to text, p_retry_after_ms integer, p_outcome text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  at_time timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('healthy','promoted','unavailable','inconclusive','provider_limited','cancelled')
    OR (p_promote_to IS NOT NULL AND (p_outcome <> 'promoted' OR p_verified IS NOT TRUE
      OR p_promote_to !~ '^gemini-[a-z0-9][a-z0-9.-]{0,58}$')) THEN RETURN false; END IF;
  UPDATE public.coaching_model_selection
     SET model = COALESCE(p_promote_to, model),
         revision = revision + CASE WHEN p_promote_to IS NOT NULL AND p_promote_to <> model THEN 1 ELSE 0 END,
         checked = checked OR p_verified IS NOT NULL,
         verified = COALESCE(p_verified, verified),
         verified_until = CASE WHEN p_verified THEN at_time + interval '60 seconds'
           WHEN p_verified IS FALSE THEN NULL ELSE verified_until END,
         probe_token = NULL, probe_deadline = NULL, probe_admin = false, probe_is_extra_attempt = false,
         last_check_at = at_time, last_check_id = p_token, last_check_outcome = p_outcome,
         provider_check_after = CASE WHEN p_verified THEN '-infinity'
           WHEN p_outcome = 'provider_limited' AND p_retry_after_ms > 0 THEN
             GREATEST(provider_check_after, at_time + pg_catalog.make_interval(secs => LEAST(p_retry_after_ms, 86400000) / 1000.0))
           ELSE provider_check_after END,
         user_next_check_at = CASE WHEN probe_admin THEN user_next_check_at
           WHEN p_verified OR probe_is_extra_attempt THEN
             at_time + pg_catalog.make_interval(secs => user_check_interval_seconds)
           ELSE at_time END,
         user_retry_pending = CASE WHEN p_verified THEN false WHEN probe_admin THEN user_retry_pending
           ELSE NOT probe_is_extra_attempt END
   WHERE single AND revision = p_revision AND probe_token = p_token AND probe_deadline > pg_catalog.clock_timestamp();
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_coaching_model_probe_v2(text, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finish_coaching_model_probe_v2(integer, uuid, boolean, text, integer, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_coaching_model_probe_v2(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_coaching_model_probe_v2(integer, uuid, boolean, text, integer, text) TO service_role;
