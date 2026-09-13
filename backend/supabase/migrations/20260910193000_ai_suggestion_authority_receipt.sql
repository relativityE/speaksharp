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
  -- Codex P1 3984161768: the receipt binds the exact saved payload. Computed by the database from the
  -- value the RPC wrote (jsonb::text is canonical), never supplied by a caller.
  suggestion_sha256 text NOT NULL CHECK (suggestion_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, quota_utc_date, quota_request_number)
);

ALTER TABLE public.ai_suggestion_authority_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_suggestion_authority_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_suggestion_authority_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ai_suggestion_authority_receipts TO service_role;

-- The receipt is authoritative only while the saved coaching value cannot be rewritten separately.
-- A column-level revoke cannot override an older table-level UPDATE grant, so rebuild the authenticated
-- operational whitelist and deliberately omit ai_suggestions. The service-role RPC below remains the
-- only writer and updates the value and receipt in one transaction.
REVOKE UPDATE ON public.sessions FROM authenticated;
GRANT UPDATE (
  title, duration, total_words, filler_words, custom_words, accuracy, ground_truth, transcript,
  clarity_score, wpm, status, status_reason, pause_metrics, transcript_state, updated_at
) ON public.sessions TO authenticated;

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
  v_digest text;
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

  v_digest := encode(sha256(convert_to(v_saved::text, 'UTF8')), 'hex');

  INSERT INTO public.ai_suggestion_authority_receipts (
    session_id, user_id, provider, model, provider_request_made,
    quota_scope, quota_utc_date, quota_limit, quota_request_number, suggestion_sha256
  ) VALUES (
    p_session_id, p_user_id, p_provider, p_model, true,
    p_quota_scope, p_quota_utc_date, p_quota_limit, p_quota_request_number, v_digest
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
    suggestion_sha256 = EXCLUDED.suggestion_sha256,
    cache_read_count = 0,
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

-- Trusted readback for the default-branch collector. Postgres compares the CURRENT saved value with the
-- receipt's bound digest using one canonical text form, so no client-side JSON re-serialisation can
-- disagree with it. Returns digests and receipt facts; the collector never trusts a mutable value alone.
CREATE OR REPLACE FUNCTION public.read_ai_suggestion_authority_v1(p_session_ids uuid[])
RETURNS TABLE (
  session_id uuid,
  user_id uuid,
  ai_suggestions jsonb,
  provider text,
  model text,
  provider_request_made boolean,
  quota_scope text,
  quota_utc_date date,
  quota_limit integer,
  quota_request_number integer,
  cache_read_count integer,
  receipt_suggestion_sha256 text,
  current_suggestion_sha256 text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT s.id, s.user_id, s.ai_suggestions,
         r.provider, r.model, r.provider_request_made, r.quota_scope, r.quota_utc_date,
         r.quota_limit, r.quota_request_number, r.cache_read_count, r.suggestion_sha256,
         CASE WHEN s.ai_suggestions IS NULL THEN NULL
              ELSE encode(sha256(convert_to(s.ai_suggestions::text, 'UTF8')), 'hex') END
    FROM public.sessions AS s
    LEFT JOIN public.ai_suggestion_authority_receipts AS r
      ON r.session_id = s.id AND r.user_id = s.user_id
   WHERE s.id = ANY (p_session_ids);
$$;

REVOKE ALL ON FUNCTION public.read_ai_suggestion_authority_v1(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_ai_suggestion_authority_v1(uuid[]) TO service_role;
