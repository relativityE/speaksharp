-- P0 (security / data integrity) — SERVER-SIDE ownership enforcement for a report's session_id.
--
-- Context: the client route helper (deriveSessionIdFromPath, /analytics/:sessionId, UUID-validated)
-- fixes WHICH id is proposed, but UUID syntax is NOT authorization — a client can POST any UUID. This
-- trigger enforces ownership at the trusted database boundary: on INSERT or on UPDATE OF session_id /
-- user_id, a non-NULL session_id is retained ONLY if that session exists AND belongs to the SAME
-- account that owns the report (public.sessions.user_id = user_issue_reports.user_id). Otherwise the
-- session_id is coerced to NULL.
--
-- Effect:
--   * A report can never be linked to another user's session, even if the client knows the UUID.
--   * Anonymous reports (user_id IS NULL) can never claim a session.
--   * A nonexistent / deleted / foreign-owned session id becomes NULL rather than being rejected —
--     because this is a BEFORE trigger it runs before the session_id FK check, so the legitimate
--     report is NEVER lost over a stale/bad/foreign id (persistence stays authoritative and succeeds).
--   * Fail-closed by construction: the DEFAULT outcome for any non-owned id is NULL.
--
-- Scope: this migration adds ONLY the ownership trigger and its function. It does NOT alter table
-- columns, RLS policies, or grants, and introduces no other object or unrelated machinery.

CREATE OR REPLACE FUNCTION public.enforce_report_session_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.session_id IS NOT NULL THEN
    -- Coerce to NULL unless the session exists AND is owned by the same account as the report.
    IF NEW.user_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.sessions s
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

-- SECURITY DEFINER runs as the function owner so the ownership EXISTS check is authoritative and not
-- itself subject to the caller's RLS; the function only READS sessions to decide and only WRITES
-- NEW.session_id on the row being inserted/updated. Lock down EXECUTE to the roles that write reports.
REVOKE ALL ON FUNCTION public.enforce_report_session_ownership() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_report_session_ownership() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_report_session_ownership ON public.user_issue_reports;
CREATE TRIGGER trg_enforce_report_session_ownership
  -- Revalidate on user_id changes too: a later user_id change must not leave a report pointing at
  -- another account's session.
  BEFORE INSERT OR UPDATE OF session_id, user_id ON public.user_issue_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_report_session_ownership();

-- ----------------------------------------------------------------------------------------------------
-- ROLLBACK (manual; forward-only migration history):
--   DROP TRIGGER IF EXISTS trg_enforce_report_session_ownership ON public.user_issue_reports;
--   DROP FUNCTION IF EXISTS public.enforce_report_session_ownership();
--
-- ORDERING WARNING (does not weaken ownership protection):
--   This guard MUST be applied BEFORE the client-side attribution change (PR #1014) ships, so that any
--   proposed session_id is always ownership-checked at the DB. When rolling back, REVERT THE CLIENT
--   ATTRIBUTION CHANGE FIRST, then drop this guard — never drop the guard while the client is actively
--   proposing route-derived session ids, or unowned links could be persisted again.
-- ----------------------------------------------------------------------------------------------------
