-- #1282 blocker 3 — one-time COMMERCIAL-ACTIVATION stamp for existing unpaid beta accounts.
--
-- SEPARATE from the trial foundation (20260812000000) on purpose: applying it starts the 30-day clock for
-- existing unpaid accounts, so its APPLY TIMESTAMP IS THE LAUNCH AUTHORITY. Apply it ONLY in the recorded
-- commercial-activation window — never during an early compatibility/security apply.
--
-- ONE-TIME via a DEDICATED, IMMUTABLE grant marker (commercial_trial_granted_at) — NOT `trial_started_at`,
-- which legacy beta accounts may already carry as an EXPIRED non-null value (they must still get one fresh
-- window). The marker guarantees:
--   * every existing UNPAID account WITHOUT the marker gets exactly one fresh window from the apply time;
--   * paid accounts (status 'pro' AND a real stripe_subscription_id) are never touched;
--   * a re-apply sees the marker set and CANNOT extend/reset the window;
--   * new accounts continue through ensure_trial_profile_for_new_user (their own signup clock).

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS commercial_trial_granted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.user_profiles.commercial_trial_granted_at IS
  '#1282: immutable marker set exactly once when the commercial-activation stamp grants an existing unpaid '
  'beta account its fresh 30-day window. Its presence prevents any re-grant/extension on re-apply.';

-- READ-ONLY PREFLIGHT: how many accounts WOULD be stamped, and how many paid accounts are protected. This
-- (not the NOTICE below) is the count authority — run/capture it before authorizing the apply.
DO $$
DECLARE
    v_eligible integer;
    v_paid_protected integer;
BEGIN
    SELECT count(*) INTO v_eligible FROM public.user_profiles
      WHERE commercial_trial_granted_at IS NULL
        AND NOT (lower(COALESCE(subscription_status, 'free')) = 'pro'
                 AND NULLIF(trim(COALESCE(stripe_subscription_id, '')), '') IS NOT NULL);
    SELECT count(*) INTO v_paid_protected FROM public.user_profiles
      WHERE lower(COALESCE(subscription_status, 'free')) = 'pro'
        AND NULLIF(trim(COALESCE(stripe_subscription_id, '')), '') IS NOT NULL;
    RAISE NOTICE '#1282 preflight: % unpaid account(s) will be granted a fresh 30-day window; % paid account(s) protected', v_eligible, v_paid_protected;
END $$;

-- APPLY the one-time grant + set the immutable marker in the SAME statement (atomic; a rerun matches none).
DO $$
DECLARE
    v_count integer;
BEGIN
    WITH stamped AS (
        UPDATE public.user_profiles
        SET trial_started_at = now(),
            trial_expires_at = now() + interval '30 days',
            commercial_trial_granted_at = now(),
            updated_at = now()
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
