-- #1294: New accounts were receiving a 30-day trial WINDOW but a NULL commercial_trial_granted_at, so
-- public.effective_subscription_tier resolved them to 'free' (server: trial_expired) — real signups included.
--
-- Root cause: a profile-creating path (the classic Supabase public.handle_new_user() new-user trigger, which
-- exists outside the migration set) inserts the user_profiles row BEFORE on_auth_user_created_trial_profile
-- fires, so ensure_trial_profile_for_new_user() takes its ON CONFLICT branch. The 20260812040000 version kept
-- commercial_trial_granted_at = the pre-existing value (NULL), so the immutable grant was never stamped.
--
-- Fix (minimal, idempotent): on conflict, COALESCE the grant — keep an existing immutable grant if present,
-- otherwise stamp it now (the same instant the fresh 30-day window is stamped). The immutability guard
-- preserve_commercial_trial_grant() permits exactly the NULL -> timestamp transition, so this is safe. This
-- fires ONLY on auth.users INSERT (new accounts); it never back-stamps pre-existing accounts (that remains the
-- separately-authorized activation migration 20260812042000, still held). Re-applies the 20260811143000
-- SECURITY DEFINER hardening (search_path pinned, EXECUTE revoked) since the function is replaced.

CREATE OR REPLACE FUNCTION public.ensure_trial_profile_for_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.user_profiles (
    id,
    subscription_status,
    private_sample_limit_seconds,
    private_sample_seconds_used,
    trial_started_at,
    trial_expires_at,
    commercial_trial_granted_at
  )
  VALUES (
    NEW.id,
    'free',
    300,
    0,
    now(),
    now() + interval '30 days',
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    subscription_status = CASE
      WHEN lower(COALESCE(public.user_profiles.subscription_status, 'free')) = 'pro'
        AND NULLIF(trim(COALESCE(public.user_profiles.stripe_subscription_id, '')), '') IS NOT NULL
      THEN public.user_profiles.subscription_status
      ELSE 'free'
    END,
    private_sample_limit_seconds = COALESCE(public.user_profiles.private_sample_limit_seconds, EXCLUDED.private_sample_limit_seconds),
    private_sample_seconds_used = COALESCE(public.user_profiles.private_sample_seconds_used, 0),
    -- Preserve an existing window if the profile already had one (idempotent re-entry); only stamp
    -- the fresh 30-day window when absent. Never shortens or backdates a live window.
    trial_started_at = COALESCE(public.user_profiles.trial_started_at, EXCLUDED.trial_started_at),
    trial_expires_at = COALESCE(public.user_profiles.trial_expires_at, EXCLUDED.trial_expires_at),
    -- #1294: keep an existing IMMUTABLE grant, else stamp it now (a NULL -> now() transition the immutability
    -- guard allows). This closes the race where another new-user trigger created the row with a NULL grant.
    commercial_trial_granted_at = COALESCE(public.user_profiles.commercial_trial_granted_at, EXCLUDED.commercial_trial_granted_at),
    updated_at = now();

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_trial_profile_for_new_user() FROM PUBLIC, anon, authenticated, service_role;
