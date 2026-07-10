-- Rename issue-report categories from engineering jargon to stable, user-neutral slugs.
-- The DB stores slugs; the frontend maps each slug to a friendly visible label. We never
-- store labels-with-spaces/slashes as raw values. Existing rows are BACKFILLED (never deleted or
-- truncated) so the prior QA rows (incl. the `general` report) remain queryable under the new slug.
--
-- Mapping:
--   stt          -> recording_transcription
--   analytics    -> analytics_sessions
--   billing      -> billing_subscription
--   account      -> account_signin
--   privacy      -> privacy_data
--   performance  -> speed_performance
--   general      -> something_else
--
-- ROLLOUT NOTE: this is a direct (new-slug-only) migration — safe because it runs PRE-LAUNCH
-- (no external beta users yet; the table holds only internal/QA rows). Accepted trade-off: a
-- stale pre-deploy tab may fail Report Issue until a hard refresh, and all QA sessions hard-refresh
-- after deploy. If external users were already live this would instead need an expand-contract
-- CHECK (tolerating old+new values during the window).

-- 1. Drop the old category CHECK so existing rows can be remapped without violating it.
ALTER TABLE public.user_issue_reports
  DROP CONSTRAINT IF EXISTS user_issue_reports_category_safe;

-- 2. Backfill existing rows to the new slugs (idempotent: only touches known old values).
UPDATE public.user_issue_reports
SET category = CASE category
  WHEN 'stt'         THEN 'recording_transcription'
  WHEN 'analytics'   THEN 'analytics_sessions'
  WHEN 'billing'     THEN 'billing_subscription'
  WHEN 'account'     THEN 'account_signin'
  WHEN 'privacy'     THEN 'privacy_data'
  WHEN 'performance' THEN 'speed_performance'
  WHEN 'general'     THEN 'something_else'
  ELSE category
END
WHERE category IN ('stt', 'analytics', 'billing', 'account', 'privacy', 'performance', 'general');

-- 3. New column default matches the neutral catch-all slug.
ALTER TABLE public.user_issue_reports
  ALTER COLUMN category SET DEFAULT 'something_else';

-- 4. Re-add the CHECK with the new slug set only.
ALTER TABLE public.user_issue_reports
  ADD CONSTRAINT user_issue_reports_category_safe CHECK (
    category IN (
      'recording_transcription',
      'analytics_sessions',
      'billing_subscription',
      'account_signin',
      'privacy_data',
      'speed_performance',
      'something_else'
    )
  );
