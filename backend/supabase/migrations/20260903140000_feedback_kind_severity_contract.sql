-- #1408 — a Comment has no defect severity, and the storage must be able to say so.
--
-- `severity` is NOT NULL and constrained to low/medium/high/critical: a defect vocabulary. Share Feedback
-- now also carries Comments — praise, questions, suggestions — which have no impact rating at all.
--
-- Writing 'low' or 'medium' for a Comment would be a lie the database then vouches for: every downstream
-- consumer that ranks by severity would rank compliments beside defects, which is exactly the failure
-- this work exists to remove. A dedicated non-defect value lets a Comment be stored honestly and makes
-- accidental severity-ranking impossible: 'not_applicable' has no position in the defect ordering.
--
-- Additive. No historical migration is edited, and no existing row is rewritten: rows already carrying a
-- defect severity keep it.

BEGIN;

ALTER TABLE public.user_issue_reports
  DROP CONSTRAINT IF EXISTS user_issue_reports_severity_safe;

-- PERMITTING the value is not the same as ENFORCING it. Widening the vocabulary alone would let an
-- Issue be stored as 'not_applicable' (invisible to severity triage) and a Comment be stored as
-- 'critical' (ranked beside real defects) -- both of which are the failure this migration exists to
-- prevent. The kind and the severity must agree, and the database is the only place that can insist.
ALTER TABLE public.user_issue_reports
  ADD CONSTRAINT user_issue_reports_severity_safe CHECK (
    CASE metadata->>'feedback_kind'
      -- Explicit Comment: exactly the non-defect value, never a ranked one.
      WHEN 'comment' THEN severity = 'not_applicable'
      -- Explicit Issue: a real, ranked severity. 'not_applicable' would hide it from triage.
      WHEN 'issue'   THEN severity IN ('low', 'medium', 'high', 'critical')
      -- LEGACY rows carry no kind. They predate Share Feedback, came from an Issue-only journey, and
      -- keep the historical severity they were written with. They are left valid exactly as they are.
      ELSE severity IN ('low', 'medium', 'high', 'critical')
    END
  );

COMMENT ON COLUMN public.user_issue_reports.severity IS
  'Defect impact for an Issue. A Comment stores ''not_applicable'': it has no impact rating, and a '
  'placeholder defect severity would let consumers rank it beside real defects.';

COMMIT;
