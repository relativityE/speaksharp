/**
 * Derive the session a report/action should attach to from the current route path.
 *
 * Why this exists: some surfaces (e.g. the global Issue Report dialog) render OUTSIDE the
 * `/analytics/:sessionId` route element, so `useParams()` returns no `sessionId` and reports would
 * store a NULL session link even when opened from a session-specific Analytics page. Reading the
 * pathname (available anywhere under the Router) fixes the attribution.
 *
 * Guarantees:
 *  - Only the `/analytics/:sessionId` route carries a session id.
 *  - The id segment MUST be a syntactically valid UUID, or we return `null` — we NEVER fabricate a
 *    session link from an arbitrary or malformed path segment.
 *  - Any other route (`/analytics`, `/session`, `/`, …) → `null`.
 */

// Canonical UUID shape (any version/variant). Session ids are Postgres UUIDs; this validates the
// shape without over-restricting the version nibble.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns true iff `value` is a syntactically valid UUID string. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

/**
 * Extract the session id from a route pathname, or `null` when the route is not a valid
 * session-specific Analytics route. Only matches `/analytics/<uuid>` (optionally trailing slash).
 */
export function deriveSessionIdFromPath(pathname: unknown): string | null {
  if (typeof pathname !== 'string') return null;
  // Strip any query/hash defensively, then match exactly /analytics/<segment>.
  const path = pathname.split('?')[0].split('#')[0];
  const match = path.match(/^\/analytics\/([^/]+)\/?$/);
  if (!match) return null;
  let candidate: string;
  try {
    candidate = decodeURIComponent(match[1]).trim();
  } catch {
    return null; // malformed percent-encoding → do not fabricate
  }
  return isUuid(candidate) ? candidate : null;
}
