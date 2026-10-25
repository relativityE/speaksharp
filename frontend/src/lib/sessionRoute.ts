/**
 * Derive the session a report/action should attach to from the current route path.
 *
 * Why this exists: some surfaces (e.g. the global Issue Report dialog) render OUTSIDE the
 * `/progress/:sessionId` route element, so `useParams()` returns no `sessionId` and reports would
 * store a NULL session link even when opened from a session-specific Analytics page. Reading the
 * pathname (available anywhere under the Router) fixes the attribution.
 *
 * Guarantees:
 *  - Only the session-detail route carries a session id: `/progress/:sessionId`, or the legacy
 *    `/analytics/:sessionId` it redirects from (still matched so a report opened mid-redirect is attributed).
 *  - The id segment MUST be a syntactically valid UUID, or we return `null` — we NEVER fabricate a
 *    session link from an arbitrary or malformed path segment.
 *  - Any other route (`/progress`, `/analytics`, `/session`, `/`, …) → `null`.
 */

// Canonical UUID shape (any version/variant). Session ids are Postgres UUIDs; this validates the
// shape without over-restricting the version nibble.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns true iff `value` is a syntactically valid UUID string. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

/**
 * #1548: the canonical `/progress` pathname for a legacy `/analytics` one. The legacy `<Route>`s match case-insensitively
 * (React Router's default), so the prefix is replaced case-insensitively too: `/Analytics/<id>` must leave the alias, never
 * re-target its own unchanged path. Only the exact first segment is rewritten (`/analytics-archive` is not an alias);
 * the rest of the path keeps its original bytes.
 *
 * The router also percent-decodes each segment before matching (an encoded `/` stays encoded), so `/%61nalytics/<id>`
 * matches the alias too (Sam RETURN 1792964160.252279). The first segment is therefore compared DECODED and replaced
 * RAW; a segment that does not decode, or decodes to anything but `analytics`, is not the alias and is left as it is.
 */
export function canonicalProgressPath(pathname: string): string {
  const first = /^\/([^/]*)/.exec(pathname);
  if (!first) return pathname;
  let decoded: string;
  try {
    decoded = decodeURIComponent(first[1]);
  } catch {
    return pathname;
  }
  return decoded.toLowerCase() === 'analytics' ? `/progress${pathname.slice(first[0].length)}` : pathname;
}

/**
 * Extract the session id from a route pathname, or `null` when the route is not a valid
 * session-specific Progress route. Only matches `/progress/<uuid>` or `/analytics/<uuid>` (optionally trailing slash).
 */
export function deriveSessionIdFromPath(pathname: unknown): string | null {
  if (typeof pathname !== 'string') return null;
  // Strip any query/hash defensively, then match exactly /progress/<segment> or /analytics/<segment>.
  const path = pathname.split('?')[0].split('#')[0];
  const match = path.match(/^\/(?:progress|analytics)\/([^/]+)\/?$/);
  if (!match) return null;
  let candidate: string;
  try {
    candidate = decodeURIComponent(match[1]).trim();
  } catch {
    return null; // malformed percent-encoding → do not fabricate
  }
  return isUuid(candidate) ? candidate : null;
}
