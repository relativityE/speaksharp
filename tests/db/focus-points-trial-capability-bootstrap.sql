-- Minimal Supabase surface for has_objective_capability() (20260809000000 → 20260928120000).
-- Shared by tests/db/focus-points-trial-capability.integration.test.ts (PGlite) and the PostgreSQL 17 proof workflow.
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $r$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO authenticated, anon, service_role;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $fn$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;

CREATE TABLE public.user_profiles (
  id uuid PRIMARY KEY,
  subscription_status text,
  trial_expires_at timestamptz,
  commercial_trial_granted_at timestamptz,
  stripe_subscription_id text
);
CREATE TABLE public.objective_account_capability (
  user_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false
);

-- One account per casualty. The ids name the case; no row carries customer data.
INSERT INTO public.user_profiles (id, subscription_status, trial_expires_at, commercial_trial_granted_at, stripe_subscription_id) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'free', now() + interval '29 days', now() - interval '1 day', NULL),  -- active trial
  ('a0000000-0000-4000-8000-000000000002', 'free', now() - interval '1 minute', now() - interval '31 days', NULL), -- expired trial
  ('a0000000-0000-4000-8000-000000000003', 'free', now() + interval '29 days', NULL, NULL),                        -- window without the grant marker
  ('a0000000-0000-4000-8000-000000000004', 'free', NULL, NULL, NULL),                                             -- free, no trial
  ('a0000000-0000-4000-8000-000000000005', 'pro',  NULL, NULL, 'sub_test_paid'),                                  -- paid Pro
  ('a0000000-0000-4000-8000-000000000006', 'pro',  NULL, NULL, NULL),                                             -- comped / QA Pro
  ('a0000000-0000-4000-8000-000000000007', 'free', NULL, NULL, NULL),                                             -- explicit grant
  ('a0000000-0000-4000-8000-000000000008', 'free', NULL, NULL, NULL);                                             -- neighbour of the grant
INSERT INTO public.objective_account_capability (user_id, enabled) VALUES
  ('a0000000-0000-4000-8000-000000000007', true),
  ('a0000000-0000-4000-8000-000000000002', false); -- a disabled grant row never enables an expired trial
