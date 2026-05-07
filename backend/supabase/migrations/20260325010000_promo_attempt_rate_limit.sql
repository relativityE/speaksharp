-- Promo brute-force protection.
-- Edge Function writes attempts with the service role and throttles repeated failures.

CREATE TABLE IF NOT EXISTS public.promo_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    ip_hash TEXT,
    promo_code_hash TEXT,
    success BOOLEAN NOT NULL DEFAULT false,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.promo_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access promo attempts" ON public.promo_attempts;

CREATE POLICY "Service role has full access promo attempts"
    ON public.promo_attempts
    FOR ALL
    USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_promo_attempts_user_recent
    ON public.promo_attempts(user_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_promo_attempts_ip_recent
    ON public.promo_attempts(ip_hash, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_promo_attempts_cleanup
    ON public.promo_attempts(attempted_at);
