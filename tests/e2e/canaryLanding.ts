/**
 * Authenticated post-login landing contract (pure + unit-testable; no Playwright import).
 *
 * The canary retained a pre-/practice landing assertion after `/practice` became the authenticated
 * default (rollout flag retired in #1022). The DEFAULT contract for an ordinary login with NO requested
 * deep-link is now EXACTLY `/practice`. A caller that intentionally starts from a protected deep-link must
 * pass its explicit expected destination — the assertion must never silently accept "any authenticated
 * route" (that would let a /session or /analytics regression pass an ordinary login).
 */

/** Default authenticated landing after an ordinary login (no deep-link). */
export const DEFAULT_AUTH_LANDING = '/practice';

/** Explicit-deep-link expectations callers may pass. */
export const SESSION_LANDING = '/session';
/** Explicit Progress detail deep-link; the legacy Analytics alias remains accepted. */
export const ANALYTICS_SESSION_LANDING = /^\/(?:progress|analytics)\/[^/]+\/?$/;
/** Explicit Progress index deep-link, never a substitute for the default /practice landing. */
export const ANALYTICS_INDEX_LANDING = /^\/(?:progress|analytics)\/?$/;

/** Pathname only: query-string mentions and look-alike prefixes are not Progress routes. */
export function isProgressRoutePathname(pathname: string): boolean {
  return /^\/(?:progress|analytics)(?:\/[^/]+)?\/?$/.test(pathname);
}

export type ExpectedAuthLanding = string | RegExp;

/**
 * Does the landed pathname satisfy the caller's REQUESTED destination?
 *  - a string is matched EXACTLY (default `/practice`, or an explicit `/session` / `/analytics`);
 *  - a RegExp is tested (e.g. the analytics session-detail pattern).
 * Exact/pattern only — never a broad alternation over all authenticated routes.
 */
export function isExpectedAuthLanding(
  actualPathname: string,
  expected: ExpectedAuthLanding = DEFAULT_AUTH_LANDING,
): boolean {
  return typeof expected === 'string' ? actualPathname === expected : expected.test(actualPathname);
}
