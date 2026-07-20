-- P0 (review round 2, #9) — PROTECTED operator retrieval of a full issue report by id.
--
-- Two distinct retrieval surfaces exist, do not conflate them:
--   * OWNER self-retrieval: an authenticated user reads THEIR OWN report via the existing
--     user_issue_reports RLS SELECT policy (auth.uid() = user_id). Ownership-scoped, fail-closed.
--   * OPERATOR retrieval (this function): an authorized OPERATOR/support process (service role only)
--     retrieves the COMPLETE report by id for triage. SECURITY DEFINER + service-role-only.
--
-- The full report contains prose (title/description) and possibly a transcript excerpt. This function
-- returns it to the trusted service-role caller ONLY. The caller MUST NOT write that prose to Actions
-- logs, artifacts, PostHog, or Sentry — retrieval is for authorized human triage, not telemetry.

CREATE OR REPLACE FUNCTION public.operator_get_report(p_report_id uuid)
RETURNS public.user_issue_reports
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT * FROM public.user_issue_reports WHERE id = p_report_id;
$$;

-- Fail-closed authorization: never callable by PUBLIC/anon/authenticated; only the service role.
REVOKE ALL ON FUNCTION public.operator_get_report(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operator_get_report(uuid) TO service_role;
