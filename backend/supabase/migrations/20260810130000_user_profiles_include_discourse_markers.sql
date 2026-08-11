-- #1231 filler slice 2 — persist the user's discourse-marker opt-in.
--
-- The filler HEADLINE counts true fillers (um/uh/ah) + the user's own tracked words by default;
-- discourse markers (like, so, you know, …) are OPT-IN (design of record). This column persists that
-- choice per user so the displayed session filler total reflects it uniformly.
--
-- Additive + safe: NOT NULL DEFAULT false means every existing row reads false (current behavior,
-- headline unchanged) with no backfill. The frontend also tolerates the column's ABSENCE
-- (reads `?? false`), so shipping the client ahead of applying this migration is inert, never broken.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS include_discourse_markers BOOLEAN NOT NULL DEFAULT false;
