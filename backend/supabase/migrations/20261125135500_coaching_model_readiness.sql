-- Shared service-owned model selection. No model is selected or activated by installing this migration.
CREATE TABLE public.coaching_model_selection (
  single boolean PRIMARY KEY DEFAULT true CHECK (single),
  model text NOT NULL CHECK (model ~ '^gemini-[a-z0-9][a-z0-9.-]{0,58}$'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  verified boolean NOT NULL DEFAULT false,
  verified_until timestamptz,
  probe_token uuid,
  probe_deadline timestamptz,
  next_probe_at timestamptz NOT NULL DEFAULT '-infinity',
  CHECK ((probe_token IS NULL) = (probe_deadline IS NULL)),
  CHECK (verified = (verified_until IS NOT NULL))
);
ALTER TABLE public.coaching_model_selection ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coaching_model_selection FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE ON public.coaching_model_selection TO service_role;

CREATE FUNCTION public.claim_coaching_model_probe_v1() RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  current_row public.coaching_model_selection%ROWTYPE;
  now_at timestamptz;
  token_id uuid;
  deadline_at timestamptz;
BEGIN
  SELECT * INTO current_row FROM public.coaching_model_selection WHERE single FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  now_at := pg_catalog.clock_timestamp();
  IF current_row.probe_deadline > now_at THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'busy', 'state',
      pg_catalog.jsonb_build_object('model', current_row.model, 'revision', current_row.revision));
  ELSIF current_row.next_probe_at > now_at THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'cooldown', 'state',
      pg_catalog.jsonb_build_object('model', current_row.model, 'revision', current_row.revision));
  END IF;
  token_id := pg_catalog.gen_random_uuid();
  deadline_at := now_at + interval '30 seconds';
  UPDATE public.coaching_model_selection SET probe_token = token_id, probe_deadline = deadline_at WHERE single;
  RETURN pg_catalog.jsonb_build_object('kind', 'claimed', 'lease', pg_catalog.jsonb_build_object(
    'state', pg_catalog.jsonb_build_object('model', current_row.model, 'revision', current_row.revision),
    'token', token_id, 'deadlineMs', pg_catalog.floor(EXTRACT(EPOCH FROM deadline_at) * 1000)));
END;
$$;
REVOKE ALL ON FUNCTION public.claim_coaching_model_probe_v1() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_coaching_model_probe_v1() TO service_role;

CREATE FUNCTION public.finish_coaching_model_probe_v1(
  p_revision integer, p_token uuid, p_verified boolean, p_promote_to text, p_retry_after_ms integer
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  now_at timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_promote_to IS NOT NULL AND (p_verified IS NOT TRUE
      OR p_promote_to !~ '^gemini-[a-z0-9][a-z0-9.-]{0,58}$') THEN RETURN false; END IF;
  UPDATE public.coaching_model_selection
     SET model = COALESCE(p_promote_to, model),
         revision = revision + CASE WHEN p_promote_to IS NOT NULL AND p_promote_to <> model THEN 1 ELSE 0 END,
         verified = COALESCE(p_verified, verified),
         verified_until = CASE WHEN p_verified THEN now_at + interval '60 seconds'
           WHEN p_verified IS FALSE THEN NULL ELSE verified_until END,
         probe_token = NULL,
         probe_deadline = NULL,
         next_probe_at = now_at + (pg_catalog.make_interval(secs =>
             GREATEST(CASE WHEN p_verified THEN 60 ELSE 30 END,
             LEAST(COALESCE(p_retry_after_ms, 0), 86400000) / 1000.0)::double precision))
   WHERE single AND revision = p_revision AND probe_token = p_token AND probe_deadline > pg_catalog.clock_timestamp();
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_coaching_model_probe_v1(integer, uuid, boolean, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finish_coaching_model_probe_v1(integer, uuid, boolean, text, integer) TO service_role;
