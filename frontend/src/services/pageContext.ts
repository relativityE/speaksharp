/**
 * Page-context contract for Report Issue (page-aware issue reporting).
 *
 * Resolves the CURRENT route to a small, ALLOWLISTED, content-free page identity so a tester's report
 * says exactly which product page and journey step it came from — without storing the full URL, query
 * string, hash, or any id/token. `canonicalRoute` is a route TEMPLATE (e.g. `/analytics/:sessionId`),
 * never a concrete id. This is the stable contract both the dialog (display) and the service (storage)
 * read from; it is deliberately extensible so future product pages can register their own keys.
 *
 * Nothing here reads or emits user content. The owned session UUID (when applicable) is carried
 * separately in the report's `session_id` column (validated + ownership-guarded by the DB), NOT here.
 */

export type ProductMode = 'marketing' | 'session' | 'progress' | 'account' | 'other';

export type PageKey =
  | 'home'
  | 'session'
  | 'analytics'
  | 'analytics_session'
  | 'auth'
  | 'pricing'
  | 'other';

export interface PageContext {
  pageKey: PageKey;
  pageLabel: string;
  productMode: ProductMode;
  journeyStep: string;
  /** Route TEMPLATE (ids collapsed to `:sessionId`/`:id`); never a concrete id, query, or hash. */
  canonicalRoute: string;
}

export interface IssueAreaOption { value: string; label: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_RE = /^[0-9a-f]{16,}$/i; // long hex tokens / opaque ids

/**
 * Reduce any pathname to a safe route template: strip query/hash defensively and collapse id-like
 * segments (UUIDs, long hex tokens) to `:id` so no identifier or token can leak into stored context.
 */
export function toCanonicalRoute(pathname: string | null | undefined): string {
  const clean = (pathname ?? '/').split(/[?#]/)[0];
  if (clean === '' || clean === '/') return '/';
  const segs = clean.split('/').map((s) => (UUID_RE.test(s) || OPAQUE_RE.test(s) ? ':id' : s));
  const joined = segs.join('/').replace(/\/+$/, '');
  return joined === '' ? '/' : joined;
}

/** Resolve the current pathname to its allowlisted page context. Unknown routes → a safe `other`. */
export function resolvePageContext(pathname: string | null | undefined): PageContext {
  const route = toCanonicalRoute(pathname);
  if (route === '/') return { pageKey: 'home', pageLabel: 'SpeakSharp landing', productMode: 'marketing', journeyStep: 'landing', canonicalRoute: '/' };
  if (route === '/session') return { pageKey: 'session', pageLabel: 'Session · Speaking', productMode: 'session', journeyStep: 'speaking', canonicalRoute: '/session' };
  if (route === '/analytics') return { pageKey: 'analytics', pageLabel: 'Past Progress', productMode: 'progress', journeyStep: 'progress_list', canonicalRoute: '/analytics' };
  if (route === '/analytics/:id') return { pageKey: 'analytics_session', pageLabel: 'Session Analytics', productMode: 'progress', journeyStep: 'session_detail', canonicalRoute: '/analytics/:sessionId' };
  if (route === '/pricing') return { pageKey: 'pricing', pageLabel: 'Pricing', productMode: 'marketing', journeyStep: 'pricing', canonicalRoute: '/pricing' };
  if (route.startsWith('/auth')) return { pageKey: 'auth', pageLabel: 'Account / sign-in', productMode: 'account', journeyStep: 'auth', canonicalRoute: route };
  return { pageKey: 'other', pageLabel: 'Other page', productMode: 'other', journeyStep: 'unknown', canonicalRoute: route };
}

// Page-specific "What part had a problem?" options. Every set ends with `other` so nothing is forced.
const AREAS: Record<PageKey, IssueAreaOption[]> = {
  home: [
    { value: 'understanding_choices', label: 'Understanding the choices' },
    { value: 'navigation', label: 'Navigation' },
    { value: 'visual_layout', label: 'Visual / layout' },
    { value: 'sign_in', label: 'Sign-in' },
    { value: 'other', label: 'Other' },
  ],
  session: [
    { value: 'session_mode', label: 'Session mode' },
    { value: 'mic_start', label: 'Microphone / start' },
    { value: 'recording', label: 'Recording' },
    { value: 'transcription', label: 'Transcription' },
    { value: 'feedback', label: 'Feedback' },
    { value: 'save', label: 'Save' },
    { value: 'other', label: 'Other' },
  ],
  analytics: [
    { value: 'session_list', label: 'Session list' },
    { value: 'comparison', label: 'Comparison' },
    { value: 'evidence', label: 'Evidence' },
    { value: 'navigation', label: 'Navigation' },
    { value: 'other', label: 'Other' },
  ],
  analytics_session: [
    { value: 'comparison', label: 'Comparison' },
    { value: 'evidence', label: 'Evidence' },
    { value: 'navigation', label: 'Navigation' },
    { value: 'other', label: 'Other' },
  ],
  auth: [
    { value: 'sign_in', label: 'Sign-in' },
    { value: 'sign_up', label: 'Sign-up' },
    { value: 'account', label: 'Account' },
    { value: 'other', label: 'Other' },
  ],
  pricing: [
    { value: 'pricing', label: 'Pricing' },
    { value: 'navigation', label: 'Navigation' },
    { value: 'other', label: 'Other' },
  ],
  other: [
    { value: 'navigation', label: 'Navigation' },
    { value: 'visual_layout', label: 'Visual / layout' },
    { value: 'other', label: 'Other' },
  ],
};

/** The allowlisted issue-area options for a page. Unknown keys fall back to the generic set. */
export function issueAreasFor(pageKey: PageKey): IssueAreaOption[] {
  return AREAS[pageKey] ?? AREAS.other;
}

/** Every allowlisted issue-area slug across all pages (for validation/allowlist tests). */
export const ALL_ISSUE_AREAS: readonly string[] = Array.from(
  new Set(Object.values(AREAS).flat().map((a) => a.value)),
);
