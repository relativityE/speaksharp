import { matchPath } from 'react-router-dom';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Derive the report's associated session id from the current route, validated as a UUID.
 * Returns the id ONLY for the analytics detail route (`/analytics/:sessionId`); `/analytics`,
 * `/session`, and any non-UUID param yield `null`. Uses matchPath (not raw string splitting) so a
 * report always links to the exact session the user is viewing. Ownership stays enforced downstream
 * by the sessions FK + RLS (a user only ever routes to their own session detail).
 *
 * P0 fix: IssueReportDialog is rendered from Navigation (OUTSIDE the matched <Routes> tree), so
 * useParams() did NOT receive `/analytics/:sessionId` — producing reports with a NULL session_id.
 */
export function deriveReportSessionId(pathname: string): string | null {
  const m = matchPath('/analytics/:sessionId', pathname);
  const id = m?.params?.sessionId;
  return id && UUID_RE.test(id) ? id : null;
}
