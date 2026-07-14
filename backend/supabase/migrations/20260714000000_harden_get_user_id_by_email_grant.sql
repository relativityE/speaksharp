-- Wave-1 hardening (P1): lock down EXECUTE on get_user_id_by_email.
--
-- get_user_id_by_email(text) is SECURITY DEFINER and reads auth.users by email. Its creation
-- migration (20260131175500) never revoked the Postgres default PUBLIC EXECUTE grant, unlike
-- sibling SECURITY DEFINER RPCs (e.g. process_stripe_webhook_event, create_session_and_update_usage).
-- Left at the default, an UNAUTHENTICATED caller could POST /rest/v1/rpc/get_user_id_by_email to
-- enumerate which emails have accounts and disclose the account's auth UUID.
--
-- SAFETY: the ONLY caller is the service-role `create-user` Edge Function (service_role BYPASSES
-- EXECUTE grants and is itself gated by AGENT_SECRET), so revoking PUBLIC/anon/authenticated EXECUTE
-- breaks NO user-facing / signup / invite / session flow. Matches the service-role-only convention.
REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(text) TO service_role;
