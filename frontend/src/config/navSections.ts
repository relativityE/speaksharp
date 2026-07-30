import { BarChart3, Home, Mic, type LucideIcon } from 'lucide-react';
import { TEST_IDS } from '@/constants/testIds';

/**
 * Single source of truth for the primary navigation and for route -> active-section
 * resolution.
 *
 * Adding a future page must require exactly ONE new entry here: the nav renders from
 * this list and the active-state resolution reads the same list, so no page file ever
 * carries its own "am I the current nav item?" styling.
 */
export type NavSectionId = 'home' | 'session' | 'analytics';

export interface NavSection {
    id: NavSectionId;
    label: string;
    /** Destination the nav link points at. */
    path: string;
    /**
     * Route bases that belong to this section. A base matches itself and its
     * descendants (`/session` and `/session/abc`), never a sibling that merely shares
     * a prefix (`/session-other`).
     */
    matchPaths: string[];
    icon: LucideIcon;
    testId: string;
}

/**
 * The nav renders ONLY for an authenticated session, so "Home" is the authenticated
 * home (/practice). `/` is included as an alias because AuthAwareRoot renders the same
 * practice surface there for a signed-in user.
 *
 * Labels are intentionally unchanged in this PR: renaming "Analytics" waits until the
 * Progress page is coherent, so the nav never disagrees with the page title.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
    {
        id: 'home',
        label: 'Home',
        path: '/practice',
        matchPaths: ['/practice', '/'],
        icon: Home,
        testId: TEST_IDS.NAV_HOME_LINK,
    },
    {
        id: 'session',
        label: 'Session',
        path: '/session',
        matchPaths: ['/session'],
        icon: Mic,
        testId: TEST_IDS.NAV_SESSION_LINK,
    },
    {
        id: 'analytics',
        label: 'Analytics',
        path: '/analytics',
        matchPaths: ['/analytics'],
        icon: BarChart3,
        testId: TEST_IDS.NAV_ANALYTICS_LINK,
    },
] as const;

/**
 * Collapses trailing slashes, guarantees a leading slash, and lowercases.
 *
 * Lowercasing is not cosmetic: react-router matches case-insensitively by default (only
 * `/admin/ops-status` opts into `caseSensitive`), so `/Session` and `/ANALYTICS` really
 * do render those pages. A case-sensitive resolver would leave those routes with nothing
 * highlighted.
 */
export const normalizeNavPath = (pathname: string | null | undefined): string => {
    if (!pathname) return '/';
    const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
    const trimmed = withLeadingSlash.replace(/\/+$/, '');
    return (trimmed === '' ? '/' : trimmed).toLowerCase();
};

/**
 * Boundary-aware match. `startsWith(base)` alone would light up Session on
 * `/session-other`; the match must land on a path SEGMENT boundary.
 */
const matchesRouteBase = (pathname: string, base: string): boolean => {
    const path = normalizeNavPath(pathname);
    const normalizedBase = normalizeNavPath(base);
    // The root alias is exact-only; every path starts with "/".
    if (normalizedBase === '/') return path === '/';
    return path === normalizedBase || path.startsWith(`${normalizedBase}/`);
};

/**
 * Resolves the nav section that owns a route.
 *
 * Returns null for an intentionally unmapped route (e.g. /pricing, /auth, 404) — zero
 * active items is correct there. The match bases are disjoint, so a mapped route always
 * yields exactly one section, never two.
 */
export const findMatchingNavSections = (pathname: string | null | undefined): NavSection[] =>
    NAV_SECTIONS.filter((section) =>
        section.matchPaths.some((base) => matchesRouteBase(pathname ?? '', base)),
    );

export const resolveNavSectionId = (pathname: string | null | undefined): NavSectionId | null =>
    findMatchingNavSections(pathname)[0]?.id ?? null;

/**
 * Shared item classes. Active state adds ONLY NAV_ITEM_ACTIVE_CLASS, which changes
 * background and text colour and nothing else — geometry (padding, radius, font-size,
 * font-weight) lives entirely in the base class so the bar cannot reflow on navigation.
 */
export const NAV_ITEM_BASE_CLASS = 'nav-item';
export const NAV_ITEM_ACTIVE_CLASS = 'nav-item--active';

export const navItemClassName = (isActive: boolean): string =>
    isActive ? `${NAV_ITEM_BASE_CLASS} ${NAV_ITEM_ACTIVE_CLASS}` : NAV_ITEM_BASE_CLASS;
