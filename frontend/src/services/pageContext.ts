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

export type ProductMode = 'marketing' | 'practice' | 'session' | 'progress' | 'account' | 'other';

export type PageKey =
  | 'home'
  | 'practice'
  | 'session'
  | 'analytics'
  | 'analytics_session'
  | 'auth'
  | 'pricing'
  | 'other';

/**
 * Closed practice-surface contract. `/practice` is ONE route hosting three UI states; Report Issue must
 * distinguish them WITHOUT a route change and WITHOUT trusting arbitrary strings. Only these three tokens
 * are ever accepted; anything else fails closed to `practice_home`.
 */
export type PracticeSurface = 'practice_home' | 'quick_practice_overview' | 'guided_rehearsal_unavailable';

const PRACTICE_SURFACES: Record<PracticeSurface, { pageLabel: string; journeyStep: string }> = {
  practice_home: { pageLabel: 'SpeakSharp Practice', journeyStep: 'chooser' },
  quick_practice_overview: { pageLabel: 'Quick Practice overview', journeyStep: 'quick_overview' },
  // Guided is planned, not a working product. The tester-facing LABEL is exactly "Guided Rehearsal"
  // (availability is conveyed by the internal token `guided_rehearsal_unavailable` + issue-area, NOT the
  // label). Prod Owner decision: the label must NOT read "(unavailable)".
  guided_rehearsal_unavailable: { pageLabel: 'Guided Rehearsal', journeyStep: 'guided_unavailable' },
};

export function isPracticeSurface(x: unknown): x is PracticeSurface {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(PRACTICE_SURFACES, x);
}

export interface PageContext {
  pageKey: PageKey;
  pageLabel: string;
  productMode: ProductMode;
  journeyStep: string;
  /** Route TEMPLATE (ids collapsed to `:sessionId`/`:id`); never a concrete id, query, or hash. */
  canonicalRoute: string;
  /** Set ONLY on `/practice` — which of the three closed surfaces was active when the report opened. */
  practiceSurface?: PracticeSurface;
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

// Fail-closed fallback for any route not explicitly registered. Its canonicalRoute is a CONSTANT
// (`/other`) — an unknown path's segments (which could contain an email, token, or name) are NEVER
// carried into stored context.
const OTHER_CONTEXT: PageContext = { pageKey: 'other', pageLabel: 'Other page', productMode: 'other', journeyStep: 'unknown', canonicalRoute: '/other' };

// Explicit allowlist of known routes → their canonical (id-free) templates. Keys are the normalized
// form produced by toCanonicalRoute (so /analytics/<uuid> matches '/analytics/:id').
const ROUTE_REGISTRY: Record<string, PageContext> = {
  '/': { pageKey: 'home', pageLabel: 'SpeakSharp landing', productMode: 'marketing', journeyStep: 'landing', canonicalRoute: '/' },
  '/practice': { pageKey: 'practice', pageLabel: 'SpeakSharp Practice', productMode: 'practice', journeyStep: 'chooser', canonicalRoute: '/practice' },
  '/session': { pageKey: 'session', pageLabel: 'Session · Speaking', productMode: 'session', journeyStep: 'speaking', canonicalRoute: '/session' },
  '/analytics': { pageKey: 'analytics', pageLabel: 'Past Progress', productMode: 'progress', journeyStep: 'progress_list', canonicalRoute: '/analytics' },
  '/analytics/:id': { pageKey: 'analytics_session', pageLabel: 'Session Analytics', productMode: 'progress', journeyStep: 'session_detail', canonicalRoute: '/analytics/:sessionId' },
  '/pricing': { pageKey: 'pricing', pageLabel: 'Pricing', productMode: 'marketing', journeyStep: 'pricing', canonicalRoute: '/pricing' },
  '/auth/signin': { pageKey: 'auth', pageLabel: 'Account / sign-in', productMode: 'account', journeyStep: 'auth', canonicalRoute: '/auth/signin' },
  '/auth/signup': { pageKey: 'auth', pageLabel: 'Account / sign-up', productMode: 'account', journeyStep: 'auth', canonicalRoute: '/auth/signup' },
  '/auth/reset': { pageKey: 'auth', pageLabel: 'Account / reset', productMode: 'account', journeyStep: 'auth', canonicalRoute: '/auth/reset' },
};

/**
 * Resolve the current pathname to its allowlisted page context. FAIL-CLOSED: only exactly-registered
 * routes get their template; every other route resolves to OTHER_CONTEXT with a constant `/other`
 * route, so no arbitrary path content (emails, tokens, names, encoded data) can enter stored context.
 *
 * On `/practice`, the optional `surface` selects the active UI state's label + journeyStep while keeping
 * canonicalRoute/page_url == `/practice`. An invalid/absent/stale surface fails closed to `practice_home`.
 */
export function resolvePageContext(pathname: string | null | undefined, surface?: unknown): PageContext {
  const canonical = toCanonicalRoute(pathname);
  if (canonical === '/practice') {
    const s: PracticeSurface = isPracticeSurface(surface) ? surface : 'practice_home';
    const meta = PRACTICE_SURFACES[s];
    return { pageKey: 'practice', pageLabel: meta.pageLabel, productMode: 'practice', journeyStep: meta.journeyStep, canonicalRoute: '/practice', practiceSurface: s };
  }
  return ROUTE_REGISTRY[canonical] ?? OTHER_CONTEXT;
}

// Page-specific "What part had a problem?" options. Every set ends with `other` so nothing is forced.
const AREAS: Record<PageKey, IssueAreaOption[]> = {
  // Base /practice set == the practice_home surface (used when no specific surface is active).
  practice: [
    { value: 'understanding_choices', label: 'Understanding the choices' },
    { value: 'navigation', label: 'Navigation' },
    { value: 'visual_layout', label: 'Visual / layout' },
    { value: 'other', label: 'Other' },
  ],
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

// Surface-specific issue areas for the three /practice states. Each ends with `other`.
const PRACTICE_SURFACE_AREAS: Record<PracticeSurface, IssueAreaOption[]> = {
  practice_home: [
    { value: 'understanding_choices', label: 'Understanding the choices' },
    { value: 'navigation', label: 'Navigation' },
    { value: 'visual_layout', label: 'Visual / layout' },
    { value: 'other', label: 'Other' },
  ],
  quick_practice_overview: [
    { value: 'walkthrough', label: 'Walkthrough' },
    { value: 'open_practice_session', label: 'Opening the practice session' },
    { value: 'navigation', label: 'Navigation' },
    { value: 'visual_layout', label: 'Visual / layout' },
    { value: 'other', label: 'Other' },
  ],
  guided_rehearsal_unavailable: [
    { value: 'availability', label: 'Availability' },
    { value: 'product_clarity', label: 'Product clarity' },
    { value: 'navigation', label: 'Navigation' },
    { value: 'visual_layout', label: 'Visual / layout' },
    { value: 'other', label: 'Other' },
  ],
};

/** The allowlisted issue-area options for a page. Unknown keys fall back to the generic set. */
export function issueAreasFor(pageKey: PageKey): IssueAreaOption[] {
  return AREAS[pageKey] ?? AREAS.other;
}

/**
 * The allowlisted issue-area options for a resolved context. On `/practice` the options are
 * SURFACE-specific (Quick vs Guided vs home); everywhere else they are the page's set. This is the single
 * source of truth both the dialog (display) and the service (validation) use.
 */
export function issueAreasForContext(context: PageContext): IssueAreaOption[] {
  if (context.practiceSurface) return PRACTICE_SURFACE_AREAS[context.practiceSurface];
  return issueAreasFor(context.pageKey);
}

/** Every allowlisted issue-area slug across all pages/surfaces (for validation/allowlist tests). */
export const ALL_ISSUE_AREAS: readonly string[] = Array.from(
  new Set([...Object.values(AREAS), ...Object.values(PRACTICE_SURFACE_AREAS)].flat().map((a) => a.value)),
);
