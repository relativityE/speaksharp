-- Adds a per-user daily quota for the Native/Cloud transcript formatter
-- (format-transcript Edge Function -> Gemini).
--
-- The Edge Function already keeps the Gemini key server-side, caps transcript
-- size, hard-rejects the Private engine, and calls consume_formatter_quota with a
-- degrade-open fallback. Until now that RPC did NOT exist, so the guard always
-- degraded open and never enforced anything (#35). This migration creates the
-- real backing table + atomic RPC so one authenticated user cannot drive
-- unbounded formatter (and therefore Gemini billing) volume.
--
-- Mirrors public.consume_ai_suggestion_quota exactly (same `allowed` JSON shape
-- the Edge Function checks: quota.allowed === false -> 429 QUOTA_EXCEEDED).

CREATE TABLE IF NOT EXISTS public.formatter_usage_daily (
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  usage_date date NOT NULL DEFAULT CURRENT_DATE,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, usage_date)
);

ALTER TABLE public.formatter_usage_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own formatter quota" ON public.formatter_usage_daily;
CREATE POLICY "Users can view own formatter quota"
  ON public.formatter_usage_daily
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.consume_formatter_quota(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := CURRENT_DATE;
  v_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'limit', p_limit,
      'error', 'AUTH_REQUIRED'
    );
  END IF;

  -- Atomic consume: insert the first call of the day, or increment only while
  -- still under the limit. When the limit is reached the conditional UPDATE is
  -- skipped, RETURNING yields no row, and v_count stays NULL.
  INSERT INTO public.formatter_usage_daily (
    user_id,
    usage_date,
    request_count,
    created_at,
    updated_at
  )
  VALUES (v_user_id, v_today, 1, now(), now())
  ON CONFLICT (user_id, usage_date)
  DO UPDATE SET
    request_count = public.formatter_usage_daily.request_count + 1,
    updated_at = now()
  WHERE public.formatter_usage_daily.request_count < p_limit
  RETURNING request_count INTO v_count;

  IF v_count IS NULL THEN
    SELECT request_count
    INTO v_count
    FROM public.formatter_usage_daily
    WHERE user_id = v_user_id
      AND usage_date = v_today;

    RETURN jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'limit', p_limit,
      'used', COALESCE(v_count, p_limit)
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'remaining', GREATEST(p_limit - v_count, 0),
    'limit', p_limit,
    'used', v_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_formatter_quota(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_formatter_quota(integer) TO authenticated;
