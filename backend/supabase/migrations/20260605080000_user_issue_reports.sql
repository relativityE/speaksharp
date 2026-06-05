-- User-facing issue reports for beta/release support.
-- Transcript/audio payloads are opt-in only; metadata is captured by default.

CREATE TABLE IF NOT EXISTS public.user_issue_reports (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  category text NOT NULL DEFAULT 'general',
  severity text NOT NULL DEFAULT 'medium',
  title text NOT NULL,
  description text NOT NULL,
  page_url text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  include_transcript boolean NOT NULL DEFAULT false,
  transcript_excerpt text,
  include_audio boolean NOT NULL DEFAULT false,
  audio_attachment_note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_issue_reports_category_safe CHECK (
    category IN ('stt', 'billing', 'account', 'analytics', 'privacy', 'performance', 'general')
  ),
  CONSTRAINT user_issue_reports_severity_safe CHECK (
    severity IN ('low', 'medium', 'high', 'critical')
  ),
  CONSTRAINT user_issue_reports_title_length CHECK (length(btrim(title)) BETWEEN 4 AND 160),
  CONSTRAINT user_issue_reports_description_length CHECK (length(btrim(description)) BETWEEN 10 AND 5000),
  CONSTRAINT user_issue_reports_transcript_opt_in CHECK (include_transcript OR transcript_excerpt IS NULL),
  CONSTRAINT user_issue_reports_audio_opt_in CHECK (include_audio OR audio_attachment_note IS NULL)
);

ALTER TABLE public.user_issue_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can create own issue reports" ON public.user_issue_reports;
CREATE POLICY "Users can create own issue reports"
  ON public.user_issue_reports
  FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view own issue reports" ON public.user_issue_reports;
CREATE POLICY "Users can view own issue reports"
  ON public.user_issue_reports
  FOR SELECT
  USING ((select auth.uid()) = user_id);

CREATE INDEX IF NOT EXISTS user_issue_reports_user_created_idx
  ON public.user_issue_reports (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_issue_reports_category_created_idx
  ON public.user_issue_reports (category, created_at DESC);
