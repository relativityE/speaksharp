-- Add ai_suggestions column to sessions table to persist AI feedback
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS ai_suggestions JSONB;
