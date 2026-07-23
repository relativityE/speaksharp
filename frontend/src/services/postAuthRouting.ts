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
