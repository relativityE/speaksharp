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
/** Analytics session-detail deep-link (`/analytics/:sessionId`). */
export const ANALYTICS_SESSION_LANDING = /^\/analytics\/[^/]+\/?$/;
/** Analytics index deep-link (`/analytics`, no trailing session id). */
export const ANALYTICS_INDEX_LANDING = '/analytics';

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
