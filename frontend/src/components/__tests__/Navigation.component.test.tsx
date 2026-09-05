import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NAV_ITEM_ACTIVE_CLASS, NAV_ITEM_BASE_CLASS } from '@/config/navSections';
import { render, screen, fireEvent, waitFor, act } from '../../../tests/support/test-utils';
import userEvent from '@testing-library/user-event';
import Navigation from '../Navigation';
import * as AuthProvider from '../../contexts/AuthProvider';
import { issueReportService } from '@/services/issueReportService';
import { useSessionStore } from '@/stores/useSessionStore';
import { PracticeSurfaceProvider, usePracticeSurface } from '@/components/practice/PracticeSurfaceContext';
import type { PracticeSurface } from '@/services/pageContext';
import React from 'react';

// Mock modules
vi.mock('../../contexts/AuthProvider');
vi.mock('@/services/issueReportService', async () => {
    const actual = await vi.importActual<typeof import('@/services/issueReportService')>('@/services/issueReportService');
    return {
        ...actual,
        issueReportService: {
            submit: vi.fn().mockResolvedValue({ id: 'report-1' }),
        },
    };
});

// Controllable hooks/config so we can exercise the nav upgrade CTA across tiers.
const { mockUseUserProfile, mockUseUsageLimit, mockArePaymentsEnabled } = vi.hoisted(() => ({
    mockUseUserProfile: vi.fn(),
    mockUseUsageLimit: vi.fn(),
    mockArePaymentsEnabled: vi.fn(),
}));

// Mock useUserProfile hook to avoid QueryClient dependency
vi.mock('../../hooks/useUserProfile', () => ({
    useUserProfile: () => mockUseUserProfile(),
}));
vi.mock('@/hooks/useUsageLimit', () => ({
    useUsageLimit: () => mockUseUsageLimit(),
}));
vi.mock('@/config/appRuntimeConfig', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/config/appRuntimeConfig')>();
    return { ...actual, arePaymentsEnabled: () => mockArePaymentsEnabled() };
});

// Mock react-router-dom
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => vi.fn(),
    };
});

const mockUseAuthProvider = vi.mocked(AuthProvider.useAuthProvider);

// jsdom does not apply the app stylesheet, so the no-reflow / focus-visible guarantees are
// asserted against the shipped CSS that backs the classes the elements carry.
const navCss = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../index.css'),
    'utf8',
);

describe('Navigation', () => {
    const mockSignOut = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        useSessionStore.getState().resetSession();
        // Defaults preserve prior behavior: no profile, no usage limit, payments off
        // (so the upgrade CTA stays hidden unless a test opts in).
        mockUseUserProfile.mockReturnValue({ data: null, isLoading: false, error: null });
        mockUseUsageLimit.mockReturnValue({ data: undefined });
        mockArePaymentsEnabled.mockReturnValue(false);
    });

    const renderNavigation = (initialRoute = '/') => {
        return render(<Navigation />, { route: initialRoute });
    };

    describe('Rendering', () => {
        it('should render the logo and app name', () => {
            mockUseAuthProvider.mockReturnValue({
                session: null,
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();
            expect(screen.getByText('SpeakSharp')).toBeInTheDocument();
        });

        it('should render Sign In and Get Started buttons when not authenticated', () => {
            mockUseAuthProvider.mockReturnValue({
                session: null,
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();
            expect(screen.getByText('Sign In')).toBeInTheDocument();
            expect(screen.getByText('Get Started')).toBeInTheDocument();
        });

        it('should render navigation items when authenticated', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();
            expect(screen.getAllByText('Home')).toHaveLength(2); // Desktop + mobile
            expect(screen.getAllByText('Analytics')).toHaveLength(2);
            expect(screen.getByTestId('nav-products-button')).toHaveTextContent('Products');
            expect(screen.getByTestId('nav-mobile-open-mic-link')).toHaveTextContent('Open Mic');
            expect(screen.getByTestId('nav-mobile-focus-points-link')).toHaveTextContent('Focus Points');
        });

        it('should render Sign Out button when authenticated', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();
            expect(screen.getByTestId('nav-sign-out-button')).toBeInTheDocument();
        });

        /*
         * #1047: the header used to print the full email, which at realistic lengths pushed the
         * action group into the nav links and overflowed the bar. The avatar has a fixed width — but
         * an initial is not an accessible name, so the identity must still be announced.
         */
        it('shows an avatar with a real accessible name and keeps the email out of the visual header', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user', email: 'averyveryverylongaddress@example.com' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();
            const avatar = screen.getByTestId('nav-account-avatar');
            expect(avatar).toHaveAccessibleName('Signed in as averyveryverylongaddress@example.com');
            // Visible content is the initial only.
            expect(avatar).toHaveTextContent('A');
            expect(screen.queryByText('averyveryverylongaddress@example.com')).not.toBeInTheDocument();
        });
    });

    describe('Authentication Actions', () => {
        it('should call signOut when Sign Out button is clicked', async () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();

            const signOutButton = screen.getByTestId('nav-sign-out-button');
            fireEvent.click(signOutButton);

            expect(mockSignOut).toHaveBeenCalled();
        });
    });

    describe('Issue Reporting', () => {
        it('submits a backend issue report with metadata and no transcript by default', async () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user', email: 'user@example.com' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);
            useSessionStore.getState().setSTTMode('private');
            useSessionStore.getState().updateTranscript('Sensitive transcript should require opt-in', '');

            renderNavigation('/session');

            fireEvent.click(screen.getByTestId('nav-report-issue-button'));
            fireEvent.click(screen.getByTestId('feedback-type-broke'));
            fireEvent.change(screen.getByTestId('issue-report-description'), {
                target: { value: 'Clicking the microphone did not start the recording.' },
            });
            fireEvent.click(screen.getByTestId('issue-report-submit'));

            await waitFor(() => {
                expect(issueReportService.submit).toHaveBeenCalled();
            });
            expect(issueReportService.submit).toHaveBeenCalledWith(expect.objectContaining({
                userId: 'test-user',
                category: 'recording_transcription',
                pageUrl: expect.any(String),
                includeAudio: false,
                audioAttachmentNote: null,
                metadata: expect.objectContaining({
                    route: '/session',
                    sttMode: 'private',
                }),
            }));
            // #1306: a live transcript sits in the session store, but the report NEVER offers or carries it.
            const submitArg = (issueReportService.submit as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<string, unknown>;
            expect(submitArg).not.toHaveProperty('includeTranscript');
            expect(submitArg).not.toHaveProperty('transcriptExcerpt');
            expect(JSON.stringify(submitArg)).not.toContain('Sensitive transcript should require opt-in');
        });

        it('#1306: there is no transcript opt-in UI — the live transcript is never offered or sent', async () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user', email: 'user@example.com' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);
            useSessionStore.getState().updateTranscript('This live transcript must never reach a report', '');

            renderNavigation('/session');

            fireEvent.click(screen.getByTestId('nav-report-issue-button'));
            fireEvent.click(screen.getByTestId('feedback-type-broke'));
            fireEvent.change(screen.getByTestId('issue-report-description'), {
                target: { value: 'The transcript changed after I clicked stop.' },
            });
            // The transcript checkbox + snippet field no longer exist.
            expect(screen.queryByTestId('issue-report-include-transcript')).not.toBeInTheDocument();
            expect(screen.queryByTestId('issue-report-transcript-snippet')).not.toBeInTheDocument();

            fireEvent.click(screen.getByTestId('issue-report-submit'));

            await waitFor(() => {
                expect(issueReportService.submit).toHaveBeenCalled();
            });
            const submitArg = (issueReportService.submit as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<string, unknown>;
            expect(submitArg).not.toHaveProperty('transcriptExcerpt');
            expect(JSON.stringify(submitArg)).not.toContain('This live transcript must never reach a report');
        });

        it('attaches the account id and shows the internal-ID support disclosure for authenticated reports', async () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user', email: 'user@example.com' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation('/pricing');

            fireEvent.click(screen.getByTestId('nav-report-issue-button'));
            fireEvent.click(screen.getByRole('button', { name: "What's included" }));
            expect(screen.getByTestId('issue-report-disclosure')).toHaveTextContent(/internal account reference/i);
            // #1416 item 4 — the PM-owned wording. "Never your email…" overstated the guarantee by
            // omitting the one thing the user DOES send, so the disclosure now says both halves.
            expect(screen.getByTestId('issue-report-disclosure'))
                .toHaveTextContent(/don’t automatically attach your email, name, credentials, transcript, or audio/i);
            expect(screen.getByTestId('issue-report-disclosure'))
                .toHaveTextContent(/Anything you type in the feedback box is included in your report/i);
            // Raw DB field name must not leak into user-facing copy.
            expect(screen.getByTestId('issue-report-disclosure')).not.toHaveTextContent(/user_id/i);
            expect(screen.queryByText(/Anonymous report/i)).not.toBeInTheDocument();
            expect(screen.queryByText(/Account support report/i)).not.toBeInTheDocument();

            fireEvent.click(screen.getByTestId('feedback-type-broke'));
            fireEvent.change(screen.getByTestId('issue-report-description'), {
                target: { value: 'I need help managing my billing for paid early access.' },
            });
            fireEvent.click(screen.getByTestId('issue-report-submit'));

            await waitFor(() => {
                expect(issueReportService.submit).toHaveBeenCalled();
            });
            // Under Option B the account id is attached for all authenticated reports.
            expect(issueReportService.submit).toHaveBeenCalledWith(expect.objectContaining({
                userId: 'test-user',
                category: 'billing_subscription',
            }));
        });
    });

    describe('Navigation Links', () => {
        it('authenticated Home link points to the authenticated home /practice', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();
            // Precise: the Home NAV link carries the testid (logo shares the "…Home" accessible name).
            expect(screen.getByTestId('nav-home-link')).toHaveAttribute('href', '/practice');
        });

        it('authenticated logo points to /practice; anonymous logo points to public /', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);
            const authed = renderNavigation();
            expect(screen.getByRole('link', { name: 'SpeakSharp Home' })).toHaveAttribute('href', '/practice');
            authed.unmount();

            mockUseAuthProvider.mockReturnValue({
                session: null,
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);
            renderNavigation();
            expect(screen.getByRole('link', { name: 'SpeakSharp Home' })).toHaveAttribute('href', '/');
        });

        it('Products gives direct access to both Open Mic and Focus Points', async () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            const user = userEvent.setup();
            renderNavigation();
            await user.click(screen.getByTestId('nav-products-button'));
            expect(await screen.findByTestId('nav-products-open-mic')).toHaveAttribute('href', '/session');
            expect(screen.getByTestId('nav-products-focus-points')).toHaveAttribute('href', '/practice?product=focus-points');
        });

        it('should have correct href for Analytics link', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();
            const analyticsLinks = screen.getAllByRole('link', { name: /analytics/i });
            expect(analyticsLinks[0]).toHaveAttribute('href', '/analytics');
        });
    });

    describe('Mobile Navigation', () => {
        it('should render mobile navigation when authenticated', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();
            // Mobile nav exposes Home, both products, and Analytics without a Home detour.
            const homeLinks = screen.getAllByText('Home');
            expect(homeLinks.length).toBeGreaterThan(1); // Desktop + mobile
            expect(screen.getByTestId('nav-mobile-open-mic-link')).toHaveAttribute('href', '/session');
            expect(screen.getByTestId('nav-mobile-focus-points-link')).toHaveAttribute('href', '/practice?product=focus-points');
        });

        it('should not render mobile navigation when not authenticated', () => {
            mockUseAuthProvider.mockReturnValue({
                session: null,
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();
            // Should only have desktop Sign In/Get Started, no mobile nav
            expect(screen.getByText('Sign In')).toBeInTheDocument();
            expect(screen.getByText('Get Started')).toBeInTheDocument();
        });
    });

    describe('Active Link Highlighting', () => {
        const authed = () => mockUseAuthProvider.mockReturnValue({
            session: { user: { id: 'test-user' } },
            signOut: mockSignOut,
        } as unknown as AuthProvider.AuthContextType);

        const primaryNav = () => screen.getByRole('navigation', { name: 'Primary' });
        const mobileNav = () => screen.queryByRole('navigation', { name: 'Primary mobile' });

        it('exposes a labelled navigation landmark for each bar', () => {
            authed();
            renderNavigation('/practice');
            expect(primaryNav()).toBeInTheDocument();
            expect(mobileNav()).toBeInTheDocument();
        });

        it('gives signed-out visitors a navigation landmark for their only nav links', () => {
            mockUseAuthProvider.mockReturnValue({
                session: null,
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation('/');
            const accountNav = screen.getByRole('navigation', { name: 'Account' });
            expect(accountNav).toContainElement(screen.getByText('Sign In'));
            expect(accountNav).toContainElement(screen.getByText('Get Started'));
        });

        it.each([
            ['/', 'nav-home-link'],
            ['/practice', 'nav-home-link'],
            ['/Practice', 'nav-home-link'],
            ['/practice/', 'nav-home-link'],
            ['/session', 'nav-products-button'],
            ['/session/abc123', 'nav-products-button'],
            ['/analytics', 'nav-analytics-link'],
            ['/analytics/session-42', 'nav-analytics-link'],
            ['/ANALYTICS', 'nav-analytics-link'],
            ['/analytics/', 'nav-analytics-link'],
        ])('marks exactly one item current in the desktop nav on %s', (route, expectedTestId) => {
            authed();
            renderNavigation(route);

            // Asserted PER LANDMARK, not per document: both bars are in the DOM, each owns its
            // own aria-current, and only one of them is ever displayed.
            const desktopCurrent = primaryNav().querySelectorAll('[aria-current="page"]');
            expect(desktopCurrent).toHaveLength(1);
            expect(desktopCurrent[0]).toBe(screen.getByTestId(expectedTestId));
            expect(desktopCurrent[0].className).toContain(NAV_ITEM_ACTIVE_CLASS);
        });

        it.each([
            ['/', 'Home'],
            ['/practice', 'Home'],
            ['/Practice', 'Home'],
            ['/analytics', 'Analytics'],
            ['/ANALYTICS', 'Analytics'],
            ['/analytics/session-42', 'Analytics'],
        ])('marks exactly one item current in the mobile nav on %s', (route, expectedLabel) => {
            // The mobile bar is the ONLY bar a mobile screen reader sees: the desktop nav is
            // `hidden lg:flex`, i.e. display:none there, which drops it from the a11y tree.
            // (The session routes are excluded because the bottom bar is suppressed there.)
            authed();
            renderNavigation(route);

            const mobile = screen.getByRole('navigation', { name: 'Primary mobile' });
            const mobileCurrent = mobile.querySelectorAll('[aria-current="page"]');
            expect(mobileCurrent).toHaveLength(1);
            expect(mobileCurrent[0]).toHaveTextContent(expectedLabel);
        });

        it.each([
            ['/session-other'],
            ['/pricing'],
            ['/definitely-not-a-page'],
        ])('marks no item current on the unmapped route %s', (route) => {
            authed();
            renderNavigation(route);

            // Boundary rule: /session-other must NOT activate Session.
            expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
            expect(screen.getByTestId('nav-products-button').className).not.toContain(NAV_ITEM_ACTIVE_CLASS);
        });

        it('gives active and inactive items identical geometry classes (no reflow on navigation)', () => {
            authed();
            renderNavigation('/session');

            const active = screen.getByTestId('nav-products-button');
            const inactive = screen.getByTestId('nav-home-link');

            const activeClasses = active.className.split(/\s+/).filter(Boolean);
            const inactiveClasses = inactive.className.split(/\s+/).filter(Boolean);

            // The ONLY difference between the two states is the colour-only modifier class.
            expect(activeClasses.filter((c) => c !== NAV_ITEM_ACTIVE_CLASS)).toEqual(inactiveClasses);
            expect(inactiveClasses).toContain(NAV_ITEM_BASE_CLASS);
            expect(activeClasses).toContain(NAV_ITEM_ACTIVE_CLASS);

            // …and that modifier declares nothing but background-color and color, so padding /
            // font-weight / font-size / radius cannot change between states.
            const modifierBlocks = [...navCss.matchAll(/\.nav-item--active[^{]*\{([^}]*)\}/g)];
            expect(modifierBlocks.length).toBeGreaterThan(0);
            for (const [, body] of modifierBlocks) {
                const properties = body
                    .split(';')
                    .map((decl) => decl.split(':')[0].trim())
                    .filter(Boolean);
                expect(properties.sort()).toEqual(['background-color', 'color']);
            }
        });

        it('keeps every item on a single line in both states', () => {
            const baseBlock = navCss.match(/\.nav-item\s*\{([^}]*)\}/);
            expect(baseBlock?.[1]).toContain('white-space: nowrap');
        });

        it('renders a visible keyboard focus style and focuses nav items', () => {
            authed();
            renderNavigation('/practice');

            const productsButton = screen.getByTestId('nav-products-button');
            productsButton.focus();
            expect(document.activeElement).toBe(productsButton);

            // jsdom applies no stylesheet, so the focus affordance is proven against the
            // stylesheet that ships with the class the element carries.
            expect(productsButton.className).toContain(NAV_ITEM_BASE_CLASS);
            // Must be a REAL outline: `outline: none` would satisfy a bare /outline:/ match.
            const focusBlock = navCss.match(/\.nav-item:focus-visible\s*\{([^}]*)\}/);
            expect(focusBlock?.[1]).toMatch(/outline:\s*\d+px\s+solid\s+\S+/);
            expect(focusBlock?.[1]).not.toMatch(/outline:\s*(none|0)\b/);
            expect(focusBlock?.[1]).toMatch(/outline-offset:/);
        });

        it.each(['/session', '/session/', '/Session', '/session/abc123'])(
            'suppresses the fixed bottom bar on %s so it cannot cover the recording UI',
            (route) => {
                authed();
                renderNavigation(route);
                // react-router resolves all of these to the session page, so the raw
                // `pathname !== '/session'` check used to let the bar cover live recording.
                expect(mobileNav()).not.toBeInTheDocument();
                expect(screen.getByTestId('nav-products-button')).toBeInTheDocument();
            },
        );

        it('decorative nav icons are hidden from assistive tech', () => {
            authed();
            renderNavigation('/analytics');
            const icons = primaryNav().querySelectorAll('svg');
            // Home, Analytics, Products mic, Products chevron. FAQ is no
            // longer a routed section; it is an inline dropdown in the header actions, outside
            // this Primary landmark.
            expect(icons.length).toBe(4);
            icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'));
        });
    });

    describe('Upgrade CTA — Pro detection', () => {
        const paidProProfile = {
            subscription_status: 'pro',
            stripe_subscription_id: 'sub_live_123',
        };

        beforeEach(() => {
            mockArePaymentsEnabled.mockReturnValue(true);
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'pro-user', email: 'pro@example.com' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);
        });

        it('hides the upgrade button for a confirmed paid Pro even when usage-limit reports free', () => {
            // Regression: check_usage_limit can transiently report a non-'pro' tier for a real Pro.
            // getEffectiveSubscriptionStatus prefers that usage-limit value, so the nav used to flash
            // "Upgrade to Pro" at paid users. It must trust the profile's paid entitlement instead.
            mockUseUserProfile.mockReturnValue({ data: paidProProfile, isLoading: false, error: null });
            mockUseUsageLimit.mockReturnValue({ data: { subscription_status: 'free' } });

            renderNavigation('/');

            expect(screen.queryByTestId('nav-upgrade-button')).not.toBeInTheDocument();
            expect(screen.getByText('PRO')).toBeInTheDocument();
        });

        it('shows the upgrade button for a genuine free user', () => {
            mockUseUserProfile.mockReturnValue({ data: { subscription_status: 'free' }, isLoading: false, error: null });
            mockUseUsageLimit.mockReturnValue({ data: { subscription_status: 'free' } });

            renderNavigation('/');

            expect(screen.getByTestId('nav-upgrade-button')).toBeInTheDocument();
            expect(screen.queryByText('PRO')).not.toBeInTheDocument();
        });

        it('does not present an active trial as paid Pro', () => {
            mockUseUserProfile.mockReturnValue({
                data: { subscription_status: 'free', stripe_subscription_id: null, trial_expires_at: '2999-01-01T00:00:00Z' },
                isLoading: false,
                error: null,
            });
            mockUseUsageLimit.mockReturnValue({
                data: { subscription_status: 'pro', is_pro: true, can_start: true, trial_active: true },
            });

            renderNavigation('/');

            expect(screen.queryByTestId('nav-upgrade-button')).not.toBeInTheDocument();
            expect(screen.queryByTestId('pro-badge')).not.toBeInTheDocument();
            expect(screen.queryByText('PRO')).not.toBeInTheDocument();
        });

        it.each(['/session', '/session/', '/Session', '/session/abc123', '/analytics', '/ANALYTICS', '/analytics/42', '/pricing'])(
            'hides the upgrade CTA on %s (route checks go through the shared resolver)',
            (route) => {
                mockUseUserProfile.mockReturnValue({ data: { subscription_status: 'free' }, isLoading: false, error: null });
                mockUseUsageLimit.mockReturnValue({ data: { subscription_status: 'free' } });

                renderNavigation(route);

                expect(screen.queryByTestId('nav-upgrade-button')).not.toBeInTheDocument();
            },
        );

        it('still shows the upgrade CTA on the prefix-sharing sibling /session-other', () => {
            // Proof the suppression is boundary-aware and not a blunt prefix match.
            mockUseUserProfile.mockReturnValue({ data: { subscription_status: 'free' }, isLoading: false, error: null });
            mockUseUsageLimit.mockReturnValue({ data: { subscription_status: 'free' } });

            renderNavigation('/session-other');

            expect(screen.getByTestId('nav-upgrade-button')).toBeInTheDocument();
        });

        it('treats a "pro" status without Stripe evidence as not-yet-paid (CTA still shows)', () => {
            // status 'pro' with no Stripe/subscription id is NOT a paid entitlement; the OR clause must
            // be gated on hasPaidProEntitlement, not the bare status string. usage-limit (free) wins.
            mockUseUserProfile.mockReturnValue({ data: { subscription_status: 'pro' }, isLoading: false, error: null });
            mockUseUsageLimit.mockReturnValue({ data: { subscription_status: 'free' } });

            renderNavigation('/');

            expect(screen.getByTestId('nav-upgrade-button')).toBeInTheDocument();
        });
    });
    // #1416 — Products, the brief, and the phone.
    //
    // Open Mic and Focus Points are two products on one route. `SessionPage` distinguishes them by
    // `Boolean(activeObjectiveBrief)`, so navigation that only changes the URL changes nothing, and
    // navigation state derived only from the URL describes the wrong product.
    describe('#1416 product navigation', () => {
        const authedUser = () => mockUseAuthProvider.mockReturnValue({
            session: { user: { id: 'test-user' } },
            signOut: mockSignOut,
        } as unknown as AuthProvider.AuthContextType);

        const BRIEF = { projectId: 'p1', briefId: 'b1', points: ['one', 'two'], topic: 'Demo' };

        const WithSurface: React.FC<{ surface: PracticeSurface | null }> = ({ surface }) => {
            const { setSurface } = usePracticeSurface();
            React.useEffect(() => { setSurface(surface); }, [setSurface, surface]);
            return <Navigation />;
        };

        const renderWithSurface = (route: string, surface: PracticeSurface | null) => render(
            <PracticeSurfaceProvider><WithSurface surface={surface} /></PracticeSurfaceProvider>,
            { route },
        );

        it('selecting Open Mic retires the active Focus Points brief', async () => {
            authedUser();
            useSessionStore.getState().setActiveObjectiveBrief(BRIEF);
            const user = userEvent.setup();
            renderNavigation('/session');

            await user.click(screen.getByTestId('nav-products-button'));
            await user.click(await screen.findByTestId('nav-products-open-mic'));

            // Without this the link navigates to the route the user is already on, the brief
            // survives, and SessionPage keeps rendering Focus Points.
            expect(useSessionStore.getState().activeObjectiveBrief).toBeNull();
        });

        it('marks Products current for Focus Points and stops Home claiming the page', () => {
            authedUser();
            // PracticePage opens the setup modal and immediately strips its own ?product= parameter,
            // so the route is plain /practice for the whole Focus Points flow.
            renderWithSurface('/practice', 'objective_setup');

            expect(screen.getByTestId('nav-products-button')).toHaveAttribute('aria-current', 'page');
            expect(screen.getByTestId('nav-home-link')).not.toHaveAttribute('aria-current');
        });

        it('keeps Home current on the practice home surface', () => {
            authedUser();
            renderWithSurface('/practice', 'practice_home');

            expect(screen.getByTestId('nav-home-link')).toHaveAttribute('aria-current', 'page');
            expect(screen.getByTestId('nav-products-button')).not.toHaveAttribute('aria-current');
        });

        it('offers a mobile product switch on session routes, where the bottom bar is suppressed', async () => {
            authedUser();
            const user = userEvent.setup();
            renderNavigation('/session');

            // The bottom bar is removed on /session so it cannot cover the recording UI, and the
            // desktop Products menu is hidden below lg. Without this control a phone user who
            // entered Open Mic could only reach Focus Points by going back through Home.
            expect(screen.queryByRole('navigation', { name: 'Primary mobile' })).not.toBeInTheDocument();

            await user.click(screen.getByTestId('nav-mobile-products-button'));
            expect(await screen.findByTestId('nav-mobile-products-focus-points'))
                .toHaveAttribute('href', '/practice?product=focus-points');
            expect(screen.getByTestId('nav-mobile-products-open-mic')).toHaveAttribute('href', '/session');
        });

        it('does not duplicate the product switch where the bottom bar already carries it', () => {
            authedUser();
            renderNavigation('/practice');

            expect(screen.getByRole('navigation', { name: 'Primary mobile' })).toBeInTheDocument();
            expect(screen.queryByTestId('nav-mobile-products-button')).not.toBeInTheDocument();
        });
    });
    // #1416 — a motion preference that changes AFTER mount must take effect without a reload.
    //
    // The reveal lives in the Share Feedback dialog, which lives in `Navigation` — mounted for the
    // whole session. Reading `prefers-reduced-motion` once at mount looked harmless because a dialog
    // is short lived, but the subscription's owner is not: someone who turns reduce-motion on, in OS
    // settings or because a vestibular symptom just started, would keep getting animation until they
    // reloaded the page. That is the moment the setting matters most.
    describe('#1416 reduced motion follows the current preference', () => {
        const authedUser = () => mockUseAuthProvider.mockReturnValue({
            session: { user: { id: 'test-user' } },
            signOut: mockSignOut,
        } as unknown as AuthProvider.AuthContextType);

        it('a false -> true change gives a 0ms reveal, and Navigation is never remounted', async () => {
            const listeners = new Set<() => void>();
            let reduced = false;
            const originalMatchMedia = window.matchMedia;
            window.matchMedia = ((query: string) => ({
                get matches() { return query.includes('prefers-reduced-motion') && reduced; },
                media: query,
                onchange: null,
                addEventListener: (_: string, cb: () => void) => { listeners.add(cb); },
                removeEventListener: (_: string, cb: () => void) => { listeners.delete(cb); },
                addListener: (cb: () => void) => { listeners.add(cb); },
                removeListener: (cb: () => void) => { listeners.delete(cb); },
                dispatchEvent: () => true,
            })) as unknown as typeof window.matchMedia;

            try {
                authedUser();
                const user = userEvent.setup();
                renderNavigation('/practice');
                await user.click(screen.getByTestId('nav-report-issue-button'));

                const reveal = await screen.findByTestId('issue-report-severity-reveal');
                expect(reveal).toHaveAttribute('data-reveal-ms', '160');

                // Identity of a node OUTSIDE the dialog. If Navigation remounted to pick the change
                // up, this node would be replaced — and the user's open dialog and typed draft would
                // go with it.
                const navBefore = screen.getByTestId('nav-report-issue-button');

                reduced = true;
                await act(async () => { listeners.forEach((cb) => cb()); });

                expect(screen.getByTestId('issue-report-severity-reveal')).toHaveAttribute('data-reveal-ms', '0');
                expect(screen.getByTestId('nav-report-issue-button')).toBe(navBefore);
                // The dialog is still open: the preference changed, the user's place did not.
                expect(screen.getByTestId('issue-report-description')).toBeInTheDocument();
            } finally {
                window.matchMedia = originalMatchMedia;
            }
        });
    });
});
