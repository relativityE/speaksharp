-- #1314 — contention harness EXTRAS, applied ON TOP OF the real migration chain.
--
-- This file deliberately contains NO coordinator. An earlier revision defined a simplified replacement
-- `converge_transcript_retention`, which meant the contention proof exercised a stand-in rather than the shipped
-- retention logic — weaker evidence than it appeared. The runner now applies the ACTUAL migrations
-- (#1131 transcript_state, R1 newest-two, R2 converge-on-save) and this file only supplies what those
-- migrations assume but the shared bootstrap leaves out.

\set ON_ERROR_STOP on

-- Stage A and complete_session_v2 need a tier resolver and the subscription columns.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS subscription_status text,
  ADD COLUMN IF NOT EXISTS trial_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS subscription_id text,
  ADD COLUMN IF NOT EXISTS commercial_trial_granted_at timestamptz;

CREATE OR REPLACE FUNCTION public.effective_subscription_tier(text, timestamptz, text, text, timestamptz)
  RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'pro'::text $$;

-- The legacy transcript-accepting overload must be present, because the whole point of the v2 rename is that
-- it coexists with it. R2 installs its own definition; this only guarantees one exists if R2's shape changes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='complete_session'
      AND pg_get_function_identity_arguments(p.oid) LIKE '%p_final_transcript%'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION public.complete_session(p_session_id uuid, p_status text DEFAULT 'completed',
        p_final_transcript text DEFAULT NULL, p_final_duration integer DEFAULT NULL, p_reason text DEFAULT NULL)
        RETURNS jsonb LANGUAGE sql AS 'SELECT jsonb_build_object(''overload'',''legacy'')'
    $fn$;
  END IF;
END $$;

-- Observability for the race: record every REAL coordinator entry without altering its behaviour.
CREATE TABLE IF NOT EXISTS public.retention_calls (called_for uuid, at timestamptz DEFAULT clock_timestamp());

CREATE OR REPLACE FUNCTION public.note_retention_call() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.retention_calls (called_for) VALUES (COALESCE(NEW.user_id, OLD.user_id));
  RETURN NULL;
END $$;
