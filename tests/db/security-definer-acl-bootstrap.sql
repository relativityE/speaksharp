\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TABLE public.secdef_trigger_probe(id integer PRIMARY KEY, touched boolean DEFAULT false);
CREATE TABLE public.secdef_trigger_audit(name text NOT NULL);

CREATE OR REPLACE FUNCTION public.has_objective_capability() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT auth.uid() IS NOT NULL $$;

CREATE OR REPLACE FUNCTION public.objective_start_session_v1(uuid, uuid, uuid, text, text, text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF; RETURN '10000000-0000-4000-8000-000000000001'; END $$;
CREATE OR REPLACE FUNCTION public.objective_finalize_evidence_v1(uuid, jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF; RETURN 1; END $$;
CREATE OR REPLACE FUNCTION public.objective_select_action_v1(uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF; RETURN '10000000-0000-4000-8000-000000000002'; END $$;
CREATE OR REPLACE FUNCTION public.objective_dispute_action_v1(uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF; RETURN '10000000-0000-4000-8000-000000000003'; END $$;
CREATE OR REPLACE FUNCTION public.objective_register_source_v1(uuid) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT $1 $$;

CREATE OR REPLACE FUNCTION public.acquire_recording_lease(uuid, text, boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF; RETURN '{"acquired":true}'::jsonb; END $$;
CREATE OR REPLACE FUNCTION public.heartbeat_recording_lease(uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF; RETURN '{"valid":true}'::jsonb; END $$;
CREATE OR REPLACE FUNCTION public.release_recording_lease(uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF; RETURN '{"released":true}'::jsonb; END $$;
CREATE OR REPLACE FUNCTION public.update_user_usage(integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF; RETURN true; END $$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{"success":true}'::jsonb $$;
CREATE OR REPLACE FUNCTION public.expire_stale_sessions() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN NULL; END $$;
CREATE OR REPLACE FUNCTION public.redeem_promo(text, uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{"success":true}'::jsonb $$;

CREATE OR REPLACE FUNCTION public.purge_derived_content_on_expire() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN INSERT INTO public.secdef_trigger_audit(name) VALUES ('purge'); RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN INSERT INTO public.secdef_trigger_audit(name) VALUES ('handle'); RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION public.ensure_trial_profile_for_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN INSERT INTO public.secdef_trigger_audit(name) VALUES ('ensure'); RETURN NEW; END $$;

CREATE TRIGGER secdef_handle AFTER INSERT ON public.secdef_trigger_probe
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
CREATE TRIGGER secdef_ensure AFTER INSERT ON public.secdef_trigger_probe
FOR EACH ROW EXECUTE FUNCTION public.ensure_trial_profile_for_new_user();
CREATE TRIGGER secdef_purge AFTER UPDATE OF touched ON public.secdef_trigger_probe
FOR EACH ROW EXECUTE FUNCTION public.purge_derived_content_on_expire();

-- Reproduce the hosted defect: default PUBLIC EXECUTE makes all API roles effective executors.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC, anon, authenticated, service_role;
