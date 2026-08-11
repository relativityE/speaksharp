-- #1261 paired source rollback. NOT APPLIED TO PRODUCTION.
-- This restores the hosted pre-remediation ACL/path state recorded by read-only run 31500181638.
-- It intentionally restores the insecure PUBLIC/anon exposure and is incident rollback only.

BEGIN;

GRANT EXECUTE ON FUNCTION public.has_objective_capability() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.objective_start_session_v1(uuid, uuid, uuid, text, text, text) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.objective_finalize_evidence_v1(uuid, jsonb) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.objective_select_action_v1(uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.objective_dispute_action_v1(uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.objective_register_source_v1(uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.acquire_recording_lease(uuid, text, boolean) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_recording_lease(uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_recording_lease(uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_user_usage(integer) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_sessions() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_sessions() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.redeem_promo(text, uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_derived_content_on_expire() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_trial_profile_for_new_user() TO PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.acquire_recording_lease(uuid, text, boolean) SET search_path = public;
ALTER FUNCTION public.heartbeat_recording_lease(uuid) SET search_path = public;
ALTER FUNCTION public.release_recording_lease(uuid) SET search_path = public;
ALTER FUNCTION public.update_user_usage(integer) SET search_path = public;
ALTER FUNCTION public.cleanup_expired_sessions() RESET search_path;
ALTER FUNCTION public.expire_stale_sessions() RESET search_path;
ALTER FUNCTION public.redeem_promo(text, uuid) RESET search_path;
ALTER FUNCTION public.purge_derived_content_on_expire() SET search_path = public;
ALTER FUNCTION public.handle_new_user() SET search_path = public, auth;
ALTER FUNCTION public.ensure_trial_profile_for_new_user() SET search_path = public;

COMMIT;
