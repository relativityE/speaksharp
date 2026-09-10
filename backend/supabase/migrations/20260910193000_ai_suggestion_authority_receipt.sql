-- #1432 — trusted, content-free authority for the Gemini comparison evidence.
--
-- The human packet is contributor-authored. It cannot be the authority for whether Gemini was called,
-- which model the provider reported, or which daily-quota ordinal was consumed. The Edge Function
-- writes those facts through service_role-only RPCs, atomically with the saved coaching value. A later
-- cached read increments the same server-owned receipt before returning, proving that at least one real
-- cache replay bypassed both quota and provider work.

CREATE TABLE IF NOT EXISTS public.ai_suggestion_authority_receipts (
  session_id uuid PRIMARY KEY REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider = 'google_gemini'),
  model text NOT NULL CHECK (model ~ '^[A-Za-z0-9._:-]{1,128}$'),
  provider_request_made boolean NOT NULL CHECK (provider_request_made),
  quota_scope text NOT NULL CHECK (quota_scope = 'user_utc_day'),
  quota_utc_date date NOT NULL,
  quota_limit integer NOT NULL CHECK (quota_limit > 0),
  quota_request_number integer NOT NULL CHECK (
    quota_request_number > 0 AND quota_request_number <= quota_limit
  ),
  cache_read_count integer NOT NULL DEFAULT 0 CHECK (cache_read_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, quota_utc_date, quota_request_number)
);

ALTER TABLE public.ai_suggestion_authority_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_suggestion_authority_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_suggestion_authority_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ai_suggestion_authority_receipts TO service_role;

CREATE OR REPLACE FUNCTION public.persist_ai_suggestion_with_authority_v1(
  p_session_id uuid,
  p_user_id uuid,
  p_suggestions jsonb,
  p_provider text,
  p_model text,
  p_quota_scope text,
  p_quota_utc_date date,
  p_quota_limit integer,
  p_quota_request_number integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_saved jsonb;
BEGIN
  IF p_provider <> 'google_gemini'
     OR p_quota_scope <> 'user_utc_day'
     OR p_model IS NULL
     OR p_model !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_quota_limit <= 0
     OR p_quota_request_number <= 0
     OR p_quota_request_number > p_quota_limit THEN
    RAISE EXCEPTION 'invalid AI suggestion authority receipt' USING ERRCODE = '23514';
  END IF;

  -- Do not let even a service-role caller invent a quota ordinal. The authenticated quota RPC must
  -- already have persisted this user's UTC-day counter at or beyond the claimed request number.
  IF NOT EXISTS (
    SELECT 1
      FROM public.ai_suggestion_usage_daily
     WHERE user_id = p_user_id
       AND usage_date = p_quota_utc_date
       AND request_count >= p_quota_request_number
  ) THEN
    RAISE EXCEPTION 'AI suggestion quota receipt is not backed by the usage ledger'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.sessions
     SET ai_suggestions = p_suggestions
   WHERE id = p_session_id
     AND user_id = p_user_id
  RETURNING ai_suggestions INTO v_saved;

  IF v_saved IS NULL THEN
    RAISE EXCEPTION 'session is missing or unowned' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.ai_suggestion_authority_receipts (
    session_id, user_id, provider, model, provider_request_made,
    quota_scope, quota_utc_date, quota_limit, quota_request_number
  ) VALUES (
    p_session_id, p_user_id, p_provider, p_model, true,
    p_quota_scope, p_quota_utc_date, p_quota_limit, p_quota_request_number
  )
  ON CONFLICT (session_id) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    provider = EXCLUDED.provider,
    model = EXCLUDED.model,
    provider_request_made = true,
    quota_scope = EXCLUDED.quota_scope,
    quota_utc_date = EXCLUDED.quota_utc_date,
    quota_limit = EXCLUDED.quota_limit,
    quota_request_number = EXCLUDED.quota_request_number,
    updated_at = now();

  RETURN v_saved;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_ai_suggestion_cache_read_v1(
  p_session_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.ai_suggestion_authority_receipts
     SET cache_read_count = cache_read_count + 1,
         updated_at = now()
   WHERE session_id = p_session_id
     AND user_id = p_user_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_ai_suggestion_with_authority_v1(
  uuid, uuid, jsonb, text, text, text, date, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_ai_suggestion_with_authority_v1(
  uuid, uuid, jsonb, text, text, text, date, integer, integer
) TO service_role;

REVOKE ALL ON FUNCTION public.record_ai_suggestion_cache_read_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_suggestion_cache_read_v1(uuid, uuid)
  TO service_role;
