-- #1261 proof bootstrap (throwaway, disposable Postgres only).
--
-- Reproduces the PRE-remediation hosted state for the 16 SECURITY DEFINER functions confirmed
-- anon-executable: each function is created (so it inherits the default PUBLIC EXECUTE grant), the ten
-- unsafe search_paths are set to their observed values, and the client RPCs additionally carry their
-- real explicit `authenticated` grant. Bodies are trivial — the proof asserts ACLs and search_path, not
-- behavior. This file is NEVER applied to any real database.

-- Supabase roles (bare Postgres has none). Every role implicitly inherits PUBLIC.
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;

-- Authenticated client RPCs (created with the default PUBLIC grant, plus their real authenticated grant).
CREATE OR REPLACE FUNCTION public.update_user_usage(session_duration_seconds integer)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT NULL::void $$;
GRANT EXECUTE ON FUNCTION public.update_user_usage(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_objective_capability()
  RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT true $$;
GRANT EXECUTE ON FUNCTION public.has_objective_capability() TO authenticated;

CREATE OR REPLACE FUNCTION public.objective_start_session_v1(p_project_id uuid, p_brief_id uuid, p_source_session_id uuid, p_detector_version text, p_formula_version text, p_idempotency_key text)
  RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT gen_random_uuid() $$;
GRANT EXECUTE ON FUNCTION public.objective_start_session_v1(uuid, uuid, uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.objective_finalize_evidence_v1(p_session_id uuid, p_signals jsonb)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT NULL::void $$;
GRANT EXECUTE ON FUNCTION public.objective_finalize_evidence_v1(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.objective_select_action_v1(p_session_id uuid)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT NULL::void $$;
GRANT EXECUTE ON FUNCTION public.objective_select_action_v1(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.objective_dispute_action_v1(p_action_id uuid)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT NULL::void $$;
GRANT EXECUTE ON FUNCTION public.objective_dispute_action_v1(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.objective_register_source_v1(p_source_session_id uuid)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT NULL::void $$;
GRANT EXECUTE ON FUNCTION public.objective_register_source_v1(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.acquire_recording_lease(p_lease_id uuid, p_holder_label text, p_force boolean)
  RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT true $$;
GRANT EXECUTE ON FUNCTION public.acquire_recording_lease(uuid, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.heartbeat_recording_lease(p_lease_id uuid)
  RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT true $$;
GRANT EXECUTE ON FUNCTION public.heartbeat_recording_lease(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.release_recording_lease(p_lease_id uuid)
  RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT true $$;
GRANT EXECUTE ON FUNCTION public.release_recording_lease(uuid) TO authenticated;

-- Maintenance functions (default PUBLIC grant only; two with no pinned search_path).
CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
  RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT NULL::void $$;
CREATE OR REPLACE FUNCTION public.expire_stale_sessions()
  RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT NULL::void $$;
CREATE OR REPLACE FUNCTION public.purge_derived_content_on_expire()
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT NULL::void $$;
CREATE OR REPLACE FUNCTION public.redeem_promo(p_code text, p_user_id uuid)
  RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT NULL::void $$;

-- Trigger functions (default PUBLIC grant; SECURITY DEFINER).
CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$ BEGIN RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION public.ensure_trial_profile_for_new_user()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN RETURN NEW; END $$;
