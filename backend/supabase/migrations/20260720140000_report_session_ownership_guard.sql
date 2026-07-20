-- P0 (incident) — SERVER-SIDE ownership enforcement for a report's session_id.
--
-- The client route-extraction helper (matchPath /analytics/:sessionId) fixes WHICH id is proposed,
-- but it is NOT an authorization boundary — a client could POST any UUID. This trigger enforces
-- ownership at the trusted database boundary: on insert/update of user_issue_reports, a non-NULL
-- session_id is retained ONLY if that session exists AND belongs to the SAME account that owns the
-- report (sessions.user_id = user_issue_reports.user_id). Otherwise session_id is coerced to NULL.
--
-- Effect: a report can never be associated with another user's session even if the client knows the
-- UUID. Anonymous reports (user_id IS NULL) can never claim a session. Fail-closed by construction.
-- We coerce-to-NULL rather than reject so a legitimate submission is never lost over a stale/bad id.

CREATE OR REPLACE FUNCTION public.enforce_report_session_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.session_id IS NOT NULL THEN
    IF NEW.user_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.sessions s
         WHERE s.id = NEW.session_id
           AND s.user_id = NEW.user_id
       )
    THEN
      NEW.session_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_report_session_ownership ON public.user_issue_reports;
CREATE TRIGGER trg_enforce_report_session_ownership
  -- Revalidate on user_id changes too: a later user_id change must not leave a report pointing at
  -- another account's session.
  BEFORE INSERT OR UPDATE OF session_id, user_id ON public.user_issue_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_report_session_ownership();
