-- #1261 — source-only SECURITY DEFINER ACL and search-path remediation.
-- NOT APPLIED TO PRODUCTION. Applying this migration is a separate Product Owner decision.
--
-- Hosted read-only evidence: run 31500181638 at d321bceb inspected all 48 SECURITY DEFINER
-- functions. The 16 functions below were executable through PUBLIC/anon. All four API roles
-- (PUBLIC, anon, authenticated, service_role) consequently reported true before this change.
--
-- Function-by-function disposition (P/A/U/S = current PUBLIC/anon/authenticated/service_role):
--
-- | Function | Current | Legitimate caller and internal guard | Required final grants | Final search_path |
-- |---|---|---|---|---|
-- | has_objective_capability() | T/T/T/T | authenticated client/Edge user client; derives auth.uid() | authenticated | public, pg_temp (unchanged) |
-- | objective_start_session_v1(...) | T/T/T/T | authenticated client; auth.uid(), capability, owner checks | authenticated | public, pg_temp (unchanged) |
-- | objective_finalize_evidence_v1(uuid,jsonb) | T/T/T/T | authenticated client; auth.uid(), capability, owner checks | authenticated | public, pg_temp (unchanged) |
-- | objective_select_action_v1(uuid) | T/T/T/T | authenticated Objective RPC; auth.uid(), capability, owner checks | authenticated | public, pg_temp (unchanged) |
-- | objective_dispute_action_v1(uuid) | T/T/T/T | authenticated Objective RPC; auth.uid(), capability, owner checks | authenticated | public, pg_temp (unchanged) |
-- | objective_register_source_v1(uuid) | T/T/T/T | objective-register-source Edge function; persisted owner/engine checks | service_role | public, pg_temp (unchanged) |
-- | acquire_recording_lease(uuid,text,boolean) | T/T/T/T | authenticated lease RPC; auth.uid() + per-user row | authenticated | public, pg_temp |
-- | heartbeat_recording_lease(uuid) | T/T/T/T | authenticated lease RPC; auth.uid() + lease owner | authenticated | public, pg_temp |
-- | release_recording_lease(uuid) | T/T/T/T | authenticated lease RPC; auth.uid() + lease owner | authenticated | public, pg_temp |
-- | update_user_usage(integer) | T/T/T/T | legacy authenticated usage RPC; auth.uid() scopes profile | authenticated | public, pg_temp |
-- | cleanup_expired_sessions() | T/T/T/T | database-owner/maintenance only; no API caller or auth guard | none | public, pg_temp |
-- | expire_stale_sessions() | T/T/T/T | database-owner/cron only; repository cron is not active; no auth guard | none | public, pg_temp |
-- | redeem_promo(text,uuid) | T/T/T/T | retired promo path; caller supplies user id and has no auth guard | none | public, pg_temp |
-- | purge_derived_content_on_expire() | T/T/T/T | sessions trigger only; trigger functions need no EXECUTE grant | none | public, pg_temp |
-- | handle_new_user() | T/T/T/T | auth.users trigger only; trigger functions need no EXECUTE grant | none | public, auth, pg_temp |
-- | ensure_trial_profile_for_new_user() | T/T/T/T | auth.users trigger only; trigger functions need no EXECUTE grant | none | public, pg_temp |
--
-- The three maintenance/retired functions without a proven service-role caller deliberately receive
-- no service_role grant. Database owners and a pg_cron job owned by its creator do not need an API-role
-- grant. Add a service_role grant later only with a concrete service caller and its own evidence.

BEGIN;

-- Remove both the inherited default and any explicit API-role grants first. Re-grants below establish
-- one auditable minimum authority instead of depending on migration-history accident.
REVOKE EXECUTE ON FUNCTION public.has_objective_capability() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.objective_start_session_v1(uuid, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.objective_finalize_evidence_v1(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.objective_select_action_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.objective_dispute_action_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.objective_register_source_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.acquire_recording_lease(uuid, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.heartbeat_recording_lease(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.release_recording_lease(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.update_user_usage(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_sessions() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.expire_stale_sessions() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.purge_derived_content_on_expire() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.ensure_trial_profile_for_new_user() FROM PUBLIC, anon, authenticated, service_role;

-- These two definitions exist in the hosted project as historical drift but are not created by the
-- checked-in migration chain. Guard them so a fresh reconstruction still reaches every repository-owned
-- function while a hosted apply hardens the drift definitions when they are present.
DO $hosted_drift_acl$
BEGIN
  IF to_regprocedure('public.redeem_promo(text,uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.redeem_promo(text, uuid) FROM PUBLIC, anon, authenticated, service_role';
  END IF;

  IF to_regprocedure('public.handle_new_user()') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role';
  END IF;
END
$hosted_drift_acl$;

-- Authenticated client RPCs with definition-level auth.uid()/ownership/capability guards.
GRANT EXECUTE ON FUNCTION public.has_objective_capability() TO authenticated;
GRANT EXECUTE ON FUNCTION public.objective_start_session_v1(uuid, uuid, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.objective_finalize_evidence_v1(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.objective_select_action_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.objective_dispute_action_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_recording_lease(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_recording_lease(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_recording_lease(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_usage(integer) TO authenticated;

-- The only proven service-role caller is backend/supabase/functions/objective-register-source.
GRANT EXECUTE ON FUNCTION public.objective_register_source_v1(uuid) TO service_role;

-- Definition-level safe paths for all ten exposed functions that did not already end in pg_temp.
ALTER FUNCTION public.acquire_recording_lease(uuid, text, boolean) SET search_path = public, pg_temp;
ALTER FUNCTION public.heartbeat_recording_lease(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.release_recording_lease(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.update_user_usage(integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.cleanup_expired_sessions() SET search_path = public, pg_temp;
ALTER FUNCTION public.expire_stale_sessions() SET search_path = public, pg_temp;
ALTER FUNCTION public.purge_derived_content_on_expire() SET search_path = public, pg_temp;
ALTER FUNCTION public.ensure_trial_profile_for_new_user() SET search_path = public, pg_temp;

DO $hosted_drift_path$
BEGIN
  IF to_regprocedure('public.redeem_promo(text,uuid)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.redeem_promo(text, uuid) SET search_path = public, pg_temp';
  END IF;

  IF to_regprocedure('public.handle_new_user()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.handle_new_user() SET search_path = public, auth, pg_temp';
  END IF;
END
$hosted_drift_path$;

COMMIT;

-- Paired rollback source:
-- backend/supabase/rollbacks/20260811143000_harden_exposed_security_definer_acl.rollback.sql
