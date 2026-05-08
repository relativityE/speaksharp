-- Persist the complete coaching-analysis snapshot required for returning-user
-- comparisons. Existing sessions remain valid; new/updated sessions can store
-- pause metrics and custom word counts alongside the already persisted
-- WPM, clarity, filler, transcript, AI suggestion, and engine fields.

ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS pause_metrics JSONB DEFAULT '{}'::JSONB;

COMMENT ON COLUMN public.sessions.pause_metrics IS
  'Per-session pause analysis snapshot used for returning-user coaching comparisons.';

COMMENT ON COLUMN public.sessions.custom_words IS
  'Per-session user-defined crutch word counts used for personalized comparison.';
