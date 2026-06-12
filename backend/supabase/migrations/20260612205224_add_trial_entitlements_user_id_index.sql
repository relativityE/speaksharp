-- Add a targeted index for release/audit lookup paths that join or repair
-- trial entitlements by auth user id. The table remains email-keyed for the
-- historical one-trial-per-email contract, so keep this as a partial helper
-- index instead of changing the primary key.

CREATE INDEX IF NOT EXISTS trial_entitlements_user_id_idx
  ON public.trial_entitlements (user_id)
  WHERE user_id IS NOT NULL;
