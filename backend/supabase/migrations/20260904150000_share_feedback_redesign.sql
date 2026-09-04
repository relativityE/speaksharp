-- #1404 — Share feedback redesign.
--
-- The user supplies only a feedback type and non-empty body. The legacy title/category/severity
-- columns remain populated for existing support tooling, but they are derived by the application
-- boundary instead of being questions the user must answer. A per-draft idempotency key makes a
-- retried Send create at most one row.

BEGIN;

ALTER TABLE public.user_issue_reports
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS user_issue_reports_idempotency_key_unique
  ON public.user_issue_reports (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.user_issue_reports
  DROP CONSTRAINT IF EXISTS user_issue_reports_title_length,
  DROP CONSTRAINT IF EXISTS user_issue_reports_description_length,
  DROP CONSTRAINT IF EXISTS user_issue_reports_severity_safe;

ALTER TABLE public.user_issue_reports
  ADD CONSTRAINT user_issue_reports_title_length
    CHECK (length(btrim(title)) BETWEEN 1 AND 80),
  ADD CONSTRAINT user_issue_reports_description_length
    CHECK (length(btrim(description)) BETWEEN 1 AND 5000),
  ADD CONSTRAINT user_issue_reports_severity_safe CHECK (
    CASE metadata->>'feedback_type'
      WHEN 'broke' THEN
        (metadata->>'feedback_severity' IN ('minor', 'slowed', 'blocked')
          AND severity IN ('low', 'medium', 'high'))
        OR (metadata->'feedback_severity' = 'null'::jsonb AND severity = 'not_applicable')
      WHEN 'confused' THEN severity = 'not_applicable'
      WHEN 'idea' THEN severity = 'not_applicable'
      WHEN 'praise' THEN severity = 'not_applicable'
      ELSE
        CASE metadata->>'feedback_kind'
          WHEN 'comment' THEN severity = 'not_applicable'
          ELSE severity IN ('low', 'medium', 'high', 'critical')
        END
    END
  );

COMMENT ON COLUMN public.user_issue_reports.idempotency_key IS
  'Per-draft delivery key. Repeating the same Share feedback submission creates at most one row.';

COMMIT;
