-- #1046 / PO 2026-08-09: Focus Points is a Pro-tier benefit.
--
-- has_objective_capability() now returns true for ANY Pro user
-- (user_profiles.subscription_status = 'pro') IN ADDITION to explicit per-account grants
-- (objective_account_capability.enabled). We KEEP the capability table (hybrid) so:
--   • individual testers / cohorts can still be granted without being Pro, and
--   • a non-Pro account can be enabled for QA without changing its tier.
--
-- "Pro" here is the same signal the rest of the app uses for entitlement (subscription_status = 'pro'),
-- which includes comped/QA Pro accounts — intentional, so a comped Pro (e.g. the PO's test account)
-- passes. It does NOT require a live Stripe subscription; if Focus Points ever needs *paid* Pro only,
-- tighten this to also check stripe_subscription_id (that is the "Pro is subtle" nuance).
--
-- The check is STABLE + SECURITY DEFINER and evaluated live on every RPC call — it is not cached in the
-- client or the session — so existing logged-in Pro users gain the capability immediately on their next
-- Focus Points action, with no reload or re-login.
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
            WHERE id = auth.uid() AND subscription_status = 'pro'
        );
$$;

-- CREATE OR REPLACE preserves existing privileges; re-grant defensively for idempotence.
GRANT EXECUTE ON FUNCTION public.has_objective_capability() TO authenticated;
