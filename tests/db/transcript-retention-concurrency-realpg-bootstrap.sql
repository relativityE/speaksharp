-- Real-PostgreSQL bootstrap for the #1117 R2 TWO-CONNECTION concurrency proof (NOT PGlite; NOT a migration;
-- never applied to any hosted env). Supplies only the minimal REAL dependencies the two live save writers
-- and the coordinator touch, so create_session_and_update_usage / complete_session / converge actually
-- EXECUTE on a live cluster. The R2 migration (20260804000000) is applied verbatim ON TOP of this.
-- Content-free: synthetic UUIDs and synthetic transcripts only.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role;  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon;          END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- user_profiles: the columns the two save RPCs read + the row both paths lock FOR UPDATE.
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_status text,
  trial_expires_at timestamptz,
  stripe_subscription_id text,
  subscription_id text,
  private_sample_limit_seconds int DEFAULT 300,
  private_sample_seconds_used int DEFAULT 0,
  private_sample_session_id uuid,
  private_sample_started_at timestamptz,
  private_sample_completed_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text, duration integer, total_words integer,
  filler_words jsonb DEFAULT '{}', custom_words jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(), accuracy float4, ground_truth text,
  transcript text, engine text, clarity_score float8, wpm float8, ai_suggestions jsonb,
  idempotency_key uuid UNIQUE, expires_at timestamptz, engine_version text, model_name text,
  device_type text, status text DEFAULT 'active', status_reason text,
  updated_at timestamptz DEFAULT now(), pause_metrics jsonb DEFAULT '{}'::jsonb,
  attribution_status text NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON public.sessions (user_id);

CREATE TABLE IF NOT EXISTS public.usage_checkpoints (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  incremental_seconds int NOT NULL, engine_type text, created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.session_progress_evaluations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  formula_version text NOT NULL, attribution_status text, eligible boolean NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT spe_session_formula_key UNIQUE (session_id, formula_version)
);

CREATE TABLE IF NOT EXISTS public.tier_configs (
  tier_name text PRIMARY KEY, max_concurrent_sessions int NOT NULL
);
INSERT INTO public.tier_configs (tier_name, max_concurrent_sessions)
VALUES ('free', 50), ('pro', 50) ON CONFLICT DO NOTHING;  -- high cap so the proof is about retention, not concurrency limits

-- Minimal REAL stand-ins for the two helper functions the create path calls (signatures match production).
CREATE OR REPLACE FUNCTION public.effective_subscription_tier(
  p_subscription_status text, p_trial_expires_at timestamptz, p_stripe_subscription_id text, p_subscription_id text
) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT COALESCE(p_subscription_status, 'free') $$;

CREATE OR REPLACE FUNCTION public.update_user_usage(p_duration int, p_engine_type text, p_session_id uuid)
RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('success', true, 'private_sample_seconds_remaining', 300) $$;

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sessions TO authenticated;
