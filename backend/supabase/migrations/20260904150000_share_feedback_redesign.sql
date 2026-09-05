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
  ON public.user_issue_reports (idempotency_key);

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
    -- #1416 — THE FEEDBACK CONTRACT IS ONE CONTRACT, ENFORCED HERE.
    --
    -- The previous form validated `severity` alone, so any of minor/slowed/blocked satisfied any of
    -- low/medium/high, and `feedback_kind` was never checked against `feedback_type` at all. A
    -- direct authenticated write — or any future client — could store
    -- `{feedback_type: 'praise', feedback_kind: 'issue'}`, or a `broke` report routed as a comment,
    -- and the issue/comment routing this migration exists to preserve would be corrupted by
    -- exactly the records it was meant to protect. The application boundary derives all three
    -- fields together, so the database is where that derivation can actually be held to.
    --
    -- Rows written before the redesign carry no `feedback_type`. Their branch keeps the original
    -- rule unchanged, so adding this constraint validates the existing table rather than failing on
    -- it. Only rows that CLAIM one of the four types are held to the exact pairing, and there a
    -- missing or unrecognised value is a rejection, not a pass: an unsatisfiable CHECK expression
    -- evaluates to NULL, which Postgres accepts, so the typed branch coalesces to false.
    CASE
      WHEN metadata->>'feedback_type' IS NULL THEN
        CASE metadata->>'feedback_kind'
          WHEN 'comment' THEN severity = 'not_applicable'
          ELSE severity IN ('low', 'medium', 'high', 'critical')
        END
      ELSE COALESCE(
        CASE metadata->>'feedback_type'
          WHEN 'broke' THEN
            metadata->>'feedback_kind' = 'issue'
            AND (
              (metadata->>'feedback_severity' = 'minor' AND severity = 'low')
              OR (metadata->>'feedback_severity' = 'slowed' AND severity = 'medium')
              OR (metadata->>'feedback_severity' = 'blocked' AND severity = 'high')
              OR (COALESCE(metadata->'feedback_severity', 'null'::jsonb) = 'null'::jsonb
                    AND severity = 'not_applicable')
            )
          WHEN 'confused' THEN
            metadata->>'feedback_kind' = 'comment' AND severity = 'not_applicable'
          WHEN 'idea' THEN
            metadata->>'feedback_kind' = 'comment' AND severity = 'not_applicable'
          WHEN 'praise' THEN
            metadata->>'feedback_kind' = 'comment' AND severity = 'not_applicable'
          ELSE false
        END,
        false
      )
    END
  );

COMMENT ON COLUMN public.user_issue_reports.idempotency_key IS
  'Per-draft delivery key. Repeating the same Share feedback submission creates at most one row.';

COMMIT;
