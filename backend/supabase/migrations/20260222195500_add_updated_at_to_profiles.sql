-- Add updated_at to user_profiles to support hardening functions
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Ensure usage_seconds is present (in case migrations were skipped or partial)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_profiles' AND column_name = 'usage_seconds') THEN
        ALTER TABLE public.user_profiles ADD COLUMN usage_seconds INTEGER DEFAULT 0;
    END IF;
END $$;
