/**
 * Post-auth routing helper — `/practice` is the CODE-DEFINED authenticated default.
 *
 * `/practice` is the accepted default landing for every authenticated user. Routing is decided entirely
 * in code — PostHog is not consulted for routing at all, so PostHog state (init timing, timeout, ingestion)
 * has ZERO effect on where a user lands. A valid protected deep-link still wins; unsafe/external paths rejected.
 */

/**
 * Only allow an in-app absolute path as a post-auth return destination — never an external URL or
 * protocol-relative target. Guards the `location.state.from` deep-link against open-redirect. A path
 * must start with a single "/" and not begin with "//" (protocol-relative) or contain a scheme.
 */
export function isSafeInternalPath(path: string | undefined | null): path is string {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//')) return false;
  if (/^\/\\/.test(path)) return false; // "/\" backslash trick
  if (/[a-z][a-z0-9+.-]*:/i.test(path)) return false; // any scheme (http:, javascript:, etc.)
  return true;
}

/** A safe protected deep-link (`from`) as a full path, or null when absent/unsafe. */
export function safeDeepLink(from?: { pathname?: string; search?: string } | null): string | null {
  const fromPath = from?.pathname;
  return isSafeInternalPath(fromPath) ? `${fromPath}${from?.search ?? ''}` : null;
}

/**
 * Resolve the post-auth destination. A valid protected deep-link wins; otherwise the default is the
 * unconditional `/practice` landing (no flag, no PostHog). Existing `/session` bookmarks/deep-links pass
 * through unchanged because a `from` of `/session` is a safe deep-link.
 */
export function resolvePostAuthPath(from?: { pathname?: string; search?: string } | null): string {
  return safeDeepLink(from) ?? '/practice';
}

/** The protected location `ProtectedRoute` hands to sign-in as `state.from` (a router location). */
export type PostAuthFrom = { pathname?: string; search?: string; hash?: string; state?: unknown } | null | undefined;

/** Sign-in surfaces are never a post-auth destination: returning to one would re-enter sign-in. */
function isAuthSurface(pathname: string): boolean {
  return /^\/(?:auth|signup)(?:\/|$)/i.test(pathname);
}

/**
 * #1548 — the IN-APP post-auth return, for `PostAuthRedirect`'s `<Navigate>` only. The magic-link email return URL
 * keeps `safeDeepLink` (pathname + search, no fragment): the auth provider writes its own tokens into that URL's
 * fragment, so a destination hash must never be put there.
 *
 * In-app, the validated destination keeps its hash and its ORIGINAL router state (`from.state`) — never the auth
 * wrapper's state, and a nested `state.from` is passed through as data, never followed as a destination. State is
 * handed to the router only; it is not serialized anywhere. Invalid, unsafe or sign-in destinations → `/practice`
 * with no state.
 */
export function resolveInAppPostAuthTarget(from: PostAuthFrom): { to: string; state?: unknown } {
  const path = safeDeepLink(from);
  if (path === null || isAuthSurface(from?.pathname ?? '')) return { to: '/practice' };
  const hash = typeof from?.hash === 'string' && from.hash.startsWith('#') ? from.hash : '';
  return from?.state === undefined ? { to: `${path}${hash}` } : { to: `${path}${hash}`, state: from.state };
}
