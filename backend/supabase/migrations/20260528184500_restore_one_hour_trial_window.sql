-- Restore the intended soft-release trial window to one hour.
--
-- A prior release-hardening migration extended trials to 24 hours. The current
-- product policy is a 60-minute Pro trial for new Free signups.
-- Trial access includes Private/Vault Mode and deeper feedback, not Cloud STT.

ALTER TABLE public.trial_entitlements
ALTER COLUMN trial_expires_at SET DEFAULT (now() + interval '60 minutes');

ALTER TABLE public.user_profiles
ALTER COLUMN trial_expires_at SET DEFAULT (now() + interval '60 minutes');
