-- Focus Points is included in the active 30-day trial (PO decision 2026-09-28; PM 5869975833; #1532 Codex P1 r4122079951).
--
-- DEFECT. 20260809000000 defined has_objective_capability() as an explicit per-account grant OR
-- subscription_status = 'pro'. New accounts are provisioned 'free' with a 30-day trial window and the immutable
-- commercial grant marker (ensure_trial_profile_for_new_user, 20260812041600), so every trial customer is refused
-- Focus Points (42501 → the client's 'capability' state) — contradicting "trial and paid accounts receive the same
-- product capabilities" (ENTITLEMENTS_AND_BILLING.md).
--
-- FIX. One additional branch, the CANONICAL active-trial rule of effective_subscription_tier (#1282): the immutable
-- commercial grant marker is present AND the server-side window has not expired. A bare trial_expires_at without the
-- grant marker does not count (fails closed, exactly as the canonical resolver does). The two existing branches are
-- unchanged: the explicit grant (testers/cohorts/QA) and subscription_status = 'pro' (which intentionally includes
-- comped/QA Pro — see 20260809000000).
--
-- Evaluated live on every call (STABLE, never cached), so a trial account gains the capability on its next Focus Points
-- action and loses it the moment its window passes, with no reload or re-login. Expiry is read from the database clock.
--
-- SECURITY. SECURITY DEFINER with the fixed search_path, derived only from auth.uid() (a caller can learn only their own
-- capability). CREATE OR REPLACE preserves privileges; the 20260811143000 ACL shape is re-applied explicitly so this
-- migration is correct on its own: EXECUTE for `authenticated` only — never PUBLIC, anon or service_role.
CREATE OR REPLACE FUNCTION public.has_objective_capability()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT
        COALESCE((SELECT enabled FROM public.objective_account_capability WHERE user_id = auth.uid()), false)
        OR EXISTS (
            SELECT 1 FROM public.user_profiles
            WHERE id = auth.uid()
              AND (
                  subscription_status = 'pro'
                  OR (
                      commercial_trial_granted_at IS NOT NULL
                      AND trial_expires_at IS NOT NULL
                      AND trial_expires_at > now()
                  )
              )
        );
$$;

REVOKE EXECUTE ON FUNCTION public.has_objective_capability() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_objective_capability() TO authenticated;

COMMENT ON FUNCTION public.has_objective_capability() IS
  'Focus Points capability for auth.uid(): explicit grant, subscription_status=pro, or an active trial '
  '(immutable commercial grant marker AND trial_expires_at > now(), the #1282 canonical rule). Authenticated only.';
