-- #1282 blocker 3 — one-time COMMERCIAL-ACTIVATION stamp for existing unpaid beta accounts.
--
-- SEPARATE and versioned after both the trial foundation (20260812040000) and enforcement
-- (20260812041000) on purpose: applying it starts the 30-day clock for existing unpaid accounts, so its
-- APPLY TIMESTAMP IS THE LAUNCH AUTHORITY. Apply it ONLY in the recorded commercial-activation window.
--
-- ONE-TIME via a DEDICATED, IMMUTABLE grant marker (commercial_trial_granted_at) — NOT `trial_started_at`,
-- which legacy beta accounts may already carry as an EXPIRED non-null value (they must still get one fresh
-- window). The marker guarantees:
--   * every existing UNPAID account WITHOUT the marker gets exactly one fresh window from the apply time;
--   * paid accounts (status 'pro' AND a real stripe_subscription_id) are never touched;
--   * a re-apply sees the marker set and CANNOT extend/reset the window;
--   * new accounts continue through ensure_trial_profile_for_new_user (their own signup clock).

-- Machine-readable, content-free preflight result. This SELECT (rather than a NOTICE) is the captured
-- authority for the separately approved activation operation.
SELECT jsonb_build_object(
  'eligible_unpaid', count(*) FILTER (
    WHERE commercial_trial_granted_at IS NULL
      AND NOT (lower(COALESCE(subscription_status, 'free')) = 'pro'
               AND NULLIF(trim(COALESCE(stripe_subscription_id, '')), '') IS NOT NULL)
  ),
  'paid_protected', count(*) FILTER (
    WHERE lower(COALESCE(subscription_status, 'free')) = 'pro'
      AND NULLIF(trim(COALESCE(stripe_subscription_id, '')), '') IS NOT NULL
  )
) AS commercial_trial_activation_preflight
FROM public.user_profiles;

-- APPLY the one-time grant + set the immutable marker in the SAME statement (atomic; a rerun matches none).
DO $$
DECLARE
    v_count integer;
    v_activation_at timestamptz := clock_timestamp();
BEGIN
    WITH stamped AS (
        UPDATE public.user_profiles
        SET trial_started_at = v_activation_at,
            trial_expires_at = v_activation_at + interval '30 days',
            commercial_trial_granted_at = v_activation_at,
            updated_at = v_activation_at
        WHERE commercial_trial_granted_at IS NULL
          AND NOT (
              lower(COALESCE(subscription_status, 'free')) = 'pro'
              AND NULLIF(trim(COALESCE(stripe_subscription_id, '')), '') IS NOT NULL
          )
        RETURNING 1
    )
    SELECT count(*) INTO v_count FROM stamped;
    RAISE NOTICE '#1282 trial activation stamp: % existing unpaid account(s) granted a fresh 30-day window (post-apply count)', v_count;
END $$;

-- Machine-readable, sanitized post-state. Reruns report zero remaining eligible rows and never move a grant.
SELECT jsonb_build_object(
  'remaining_eligible_unpaid', count(*) FILTER (
    WHERE commercial_trial_granted_at IS NULL
      AND NOT (lower(COALESCE(subscription_status, 'free')) = 'pro'
               AND NULLIF(trim(COALESCE(stripe_subscription_id, '')), '') IS NOT NULL)
  ),
  'commercial_trials_marked', count(*) FILTER (WHERE commercial_trial_granted_at IS NOT NULL),
  'paid_accounts', count(*) FILTER (
    WHERE lower(COALESCE(subscription_status, 'free')) = 'pro'
      AND NULLIF(trim(COALESCE(stripe_subscription_id, '')), '') IS NOT NULL
  )
) AS commercial_trial_activation_post_state
FROM public.user_profiles;
