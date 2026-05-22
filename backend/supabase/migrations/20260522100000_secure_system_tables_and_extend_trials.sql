-- Lock down shared/system tables and reduce first-run onboarding friction.

ALTER TABLE public.tier_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_checkpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read tier configs" ON public.tier_configs;
CREATE POLICY "Authenticated users can read tier configs"
ON public.tier_configs
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Users can read own usage checkpoints" ON public.usage_checkpoints;
CREATE POLICY "Users can read own usage checkpoints"
ON public.usage_checkpoints
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = user_id);

-- No anon/authenticated policies are intentionally created for
-- processed_webhook_events. Stripe webhook RPCs run as SECURITY DEFINER and
-- service-role clients bypass RLS; browser clients should have no direct path.

ALTER TABLE public.trial_entitlements
ALTER COLUMN trial_expires_at SET DEFAULT (now() + interval '24 hours');

UPDATE public.trial_entitlements
SET
  trial_expires_at = trial_started_at + interval '24 hours',
  updated_at = now()
WHERE trial_expires_at < trial_started_at + interval '24 hours';

UPDATE public.user_profiles up
SET
  trial_expires_at = te.trial_expires_at,
  updated_at = now()
FROM public.trial_entitlements te
WHERE te.user_id = up.id
  AND up.trial_expires_at IS DISTINCT FROM te.trial_expires_at;

CREATE OR REPLACE FUNCTION public.ensure_trial_profile_for_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := lower(trim(NEW.email));
  v_trial_started_at TIMESTAMPTZ;
  v_trial_expires_at TIMESTAMPTZ;
BEGIN
  IF v_email IS NULL OR v_email = '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.trial_entitlements (email, user_id)
  VALUES (v_email, NEW.id)
  ON CONFLICT (email) DO UPDATE
  SET
    user_id = COALESCE(public.trial_entitlements.user_id, EXCLUDED.user_id),
    updated_at = now()
  RETURNING trial_started_at, trial_expires_at
  INTO v_trial_started_at, v_trial_expires_at;

  INSERT INTO public.user_profiles (
    id,
    subscription_status,
    trial_started_at,
    trial_expires_at,
    usage_seconds,
    usage_reset_date,
    updated_at
  )
  VALUES (
    NEW.id,
    'basic',
    v_trial_started_at,
    v_trial_expires_at,
    0,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    trial_started_at = COALESCE(public.user_profiles.trial_started_at, EXCLUDED.trial_started_at),
    trial_expires_at = COALESCE(public.user_profiles.trial_expires_at, EXCLUDED.trial_expires_at),
    updated_at = now();

  RETURN NEW;
END;
$$;
