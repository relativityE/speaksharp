-- Option C: allow ANONYMOUS issue reports (no identity stored).
--
-- Product decision: in-app problem reports should not be tied to a user's identity — the row
-- timestamp + sttMode/route metadata (and metadata.sentryLastEventId) are enough to correlate a
-- report with our logs/Sentry. The original INSERT policy required `auth.uid() = user_id`, which
-- rejected a NULL user_id. We relax it to permit a NULL user_id (anonymous) OR a self-attributed
-- one, scoped `TO authenticated` so reports still require a logged-in session and are NOT
-- internet-spammable. The `user_id` column is already nullable (ON DELETE SET NULL).
--
-- SELECT stays "own reports only"; anonymous (NULL user_id) reports are readable only via the
-- service role (the triage/admin path), which is the intended review surface.

DROP POLICY IF EXISTS "Users can create own issue reports" ON public.user_issue_reports;
DROP POLICY IF EXISTS "Authenticated users can create issue reports" ON public.user_issue_reports;
CREATE POLICY "Authenticated users can create issue reports"
  ON public.user_issue_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NULL OR (select auth.uid()) = user_id);
