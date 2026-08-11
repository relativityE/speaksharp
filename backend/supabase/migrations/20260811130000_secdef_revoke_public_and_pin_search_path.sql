-- #1261 — SECURITY DEFINER exposure remediation.
--
-- Hosted read-only verification (db-grant-check.yml, full_scan) confirmed 16 SECURITY DEFINER functions
-- are executable by PUBLIC/anon. Postgres grants EXECUTE to PUBLIC by default on function creation, and
-- every role (anon, authenticated, service_role) inherits PUBLIC — so `has_function_privilege(...)` is
-- true for all roles ONLY because of that default grant, not because of an intended per-role grant.
--
-- This migration removes the default PUBLIC grant (which removes the anon cascade), retains only the
-- proven caller per function, and pins a pg_temp-safe search_path (pg_temp LAST) on the 10 affected
-- functions whose path did not already end in pg_temp. The 6 objective_* / has_objective_capability
-- functions already use `public, pg_temp` (pg_temp last) and keep it unchanged.
--
-- Caller matrix (source-traced; see #1261 evidence):
--   - Authenticated client RPCs: update_user_usage, has_objective_capability, the five objective_*_v1,
--     and the three *_recording_lease — invoked by the frontend objective/lease services and the
--     objective-register-source Edge function. Keep EXECUTE for `authenticated`.
--   - Maintenance (no client caller): cleanup_expired_sessions, expire_stale_sessions,
--     purge_derived_content_on_expire, redeem_promo — service/cron only. Grant EXECUTE to `service_role`.
--   - Trigger functions: handle_new_user, ensure_trial_profile_for_new_user — fire from auth.users
--     triggers as the definer and need no direct EXECUTE grant.
--
-- NOT APPLIED TO PRODUCTION BY THIS PR. Requires separate Product Owner migration approval before deploy.
-- Rollback SQL is at the bottom of this file (commented; run only to reverse an applied migration).

BEGIN;

-- ── Authenticated client RPCs: drop the PUBLIC/anon default, keep only `authenticated` ──────────────
REVOKE EXECUTE ON FUNCTION public.update_user_usage(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_user_usage(integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.has_objective_capability() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_objective_capability() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.objective_start_session_v1(uuid, uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.objective_start_session_v1(uuid, uuid, uuid, text, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.objective_finalize_evidence_v1(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.objective_finalize_evidence_v1(uuid, jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.objective_select_action_v1(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.objective_select_action_v1(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.objective_dispute_action_v1(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.objective_dispute_action_v1(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.objective_register_source_v1(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.objective_register_source_v1(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.acquire_recording_lease(uuid, text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.acquire_recording_lease(uuid, text, boolean) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.heartbeat_recording_lease(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.heartbeat_recording_lease(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.release_recording_lease(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.release_recording_lease(uuid) TO authenticated;

-- ── Maintenance functions: drop PUBLIC/anon, grant only `service_role` ──────────────────────────────
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_sessions() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cleanup_expired_sessions() TO service_role;

REVOKE EXECUTE ON FUNCTION public.expire_stale_sessions() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.expire_stale_sessions() TO service_role;

REVOKE EXECUTE ON FUNCTION public.purge_derived_content_on_expire() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.purge_derived_content_on_expire() TO service_role;

REVOKE EXECUTE ON FUNCTION public.redeem_promo(text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.redeem_promo(text, uuid) TO service_role;

-- ── Trigger functions: drop PUBLIC/anon; no direct EXECUTE grant (they fire from auth.users triggers) ─
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ensure_trial_profile_for_new_user() FROM PUBLIC, anon;

-- ── Pin pg_temp-safe search paths (pg_temp LAST) on the 10 functions whose path did not end in pg_temp.
--    pg_catalog is always searched implicitly first, so `public, pg_temp` is sufficient for public-schema
--    bodies; handle_new_user keeps `auth` (it reads auth.users) with pg_temp appended last. ─────────────
ALTER FUNCTION public.update_user_usage(integer)                                            SET search_path = public, pg_temp;
ALTER FUNCTION public.acquire_recording_lease(uuid, text, boolean)                          SET search_path = public, pg_temp;
ALTER FUNCTION public.heartbeat_recording_lease(uuid)                                       SET search_path = public, pg_temp;
ALTER FUNCTION public.release_recording_lease(uuid)                                         SET search_path = public, pg_temp;
ALTER FUNCTION public.cleanup_expired_sessions()                                            SET search_path = public, pg_temp;
ALTER FUNCTION public.expire_stale_sessions()                                               SET search_path = public, pg_temp;
ALTER FUNCTION public.purge_derived_content_on_expire()                                     SET search_path = public, pg_temp;
ALTER FUNCTION public.redeem_promo(text, uuid)                                              SET search_path = public, pg_temp;
ALTER FUNCTION public.ensure_trial_profile_for_new_user()                                   SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_new_user()                                                     SET search_path = public, auth, pg_temp;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (run only to reverse an APPLIED migration). This restores the prior EXECUTE ACLs and the prior
-- search_path values. Note: the prior state re-exposes these functions to PUBLIC/anon — roll back only as
-- deliberate incident containment, never as routine cleanup.
--
-- BEGIN;
--   -- Restore prior search_paths.
--   ALTER FUNCTION public.update_user_usage(integer)                     SET search_path = public;
--   ALTER FUNCTION public.acquire_recording_lease(uuid, text, boolean)   SET search_path = public;
--   ALTER FUNCTION public.heartbeat_recording_lease(uuid)                SET search_path = public;
--   ALTER FUNCTION public.release_recording_lease(uuid)                  SET search_path = public;
--   ALTER FUNCTION public.purge_derived_content_on_expire()              SET search_path = public;
--   ALTER FUNCTION public.ensure_trial_profile_for_new_user()            SET search_path = public;
--   ALTER FUNCTION public.handle_new_user()                              SET search_path = public, auth;
--   ALTER FUNCTION public.cleanup_expired_sessions()                     RESET search_path;
--   ALTER FUNCTION public.expire_stale_sessions()                        RESET search_path;
--   ALTER FUNCTION public.redeem_promo(text, uuid)                       RESET search_path;
--   -- Restore prior (PUBLIC) grants.
--   GRANT EXECUTE ON FUNCTION public.update_user_usage(integer) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.has_objective_capability() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.objective_start_session_v1(uuid, uuid, uuid, text, text, text) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.objective_finalize_evidence_v1(uuid, jsonb) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.objective_select_action_v1(uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.objective_dispute_action_v1(uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.objective_register_source_v1(uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.acquire_recording_lease(uuid, text, boolean) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.heartbeat_recording_lease(uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.release_recording_lease(uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.cleanup_expired_sessions() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.expire_stale_sessions() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.purge_derived_content_on_expire() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.redeem_promo(text, uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.handle_new_user() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.ensure_trial_profile_for_new_user() TO PUBLIC;
-- COMMIT;
