import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NAV_ITEM_ACTIVE_CLASS, NAV_ITEM_BASE_CLASS } from '@/config/navSections';
import { render, screen, fireEvent, waitFor } from '../../../tests/support/test-utils';
import Navigation from '../Navigation';
import * as AuthProvider from '../../contexts/AuthProvider';
import { issueReportService } from '@/services/issueReportService';
import { useSessionStore } from '@/stores/useSessionStore';

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
            expect(screen.getAllByText('Session')).toHaveLength(2);
            expect(screen.getAllByText('Analytics')).toHaveLength(2);
        });

        it('should render Sign Out button when authenticated', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();
            expect(screen.getByTestId('nav-sign-out-button')).toBeInTheDocument();
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
            fireEvent.change(screen.getByTestId('issue-report-title'), {
                target: { value: 'Private mic failed' },
            });
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
                includeTranscript: false,
                transcriptExcerpt: null,
                includeAudio: false,
                audioAttachmentNote: null,
                metadata: expect.objectContaining({
                    route: '/session',
                    sttMode: 'private',
                }),
            }));
        });

        it('includes transcript only after explicit opt-in', async () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user', email: 'user@example.com' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);
            useSessionStore.getState().updateTranscript('User chose to include this transcript', '');

            renderNavigation('/session');

            fireEvent.click(screen.getByTestId('nav-report-issue-button'));
            fireEvent.change(screen.getByTestId('issue-report-title'), {
                target: { value: 'Transcript issue' },
            });
            fireEvent.change(screen.getByTestId('issue-report-description'), {
                target: { value: 'The transcript changed after I clicked stop.' },
            });
            fireEvent.click(screen.getByTestId('issue-report-include-transcript'));
            fireEvent.change(screen.getByTestId('issue-report-transcript-snippet'), {
                target: { value: 'User chose to include this transcript' },
            });
            fireEvent.click(screen.getByTestId('issue-report-submit'));

            await waitFor(() => {
                expect(issueReportService.submit).toHaveBeenCalled();
            });
            expect(issueReportService.submit).toHaveBeenCalledWith(expect.objectContaining({
                includeTranscript: true,
                transcriptExcerpt: 'User chose to include this transcript',
            }));
        });

        it('attaches the account id and shows the internal-ID support disclosure for authenticated reports', async () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user', email: 'user@example.com' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation('/pricing');

            fireEvent.click(screen.getByTestId('nav-report-issue-button'));
            // Single support-oriented disclosure — no anonymous/account-context branching anymore.
            expect(screen.getByTestId('issue-report-disclosure')).toHaveTextContent(/Linked to your account using an internal ID/i);
            expect(screen.getByTestId('issue-report-disclosure')).toHaveTextContent(/do not include your email, name, password, login credentials, transcript, or audio/i);
            // Raw DB field name must not leak into user-facing copy.
            expect(screen.getByTestId('issue-report-disclosure')).not.toHaveTextContent(/user_id/i);
            expect(screen.queryByText(/Anonymous report/i)).not.toBeInTheDocument();
            expect(screen.queryByText(/Account support report/i)).not.toBeInTheDocument();

            fireEvent.change(screen.getByTestId('issue-report-category'), {
                target: { value: 'billing_subscription' },
            });
            fireEvent.change(screen.getByTestId('issue-report-title'), {
                target: { value: 'Billing portal issue' },
            });
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

        it('should have correct href for Session link', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } },
                signOut: mockSignOut,
            } as unknown as AuthProvider.AuthContextType);

            renderNavigation();
            const sessionLinks = screen.getAllByRole('link', { name: /session/i });
            expect(sessionLinks[0]).toHaveAttribute('href', '/session');
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
            // Mobile nav should have Home, Session, Analytics
            const homeLinks = screen.getAllByText('Home');
            expect(homeLinks.length).toBeGreaterThan(1); // Desktop + mobile
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

        it('exposes a labelled primary navigation landmark', () => {
            authed();
            renderNavigation('/practice');
            expect(primaryNav()).toBeInTheDocument();
        });

        it.each([
            ['/', 'nav-home-link'],
            ['/practice', 'nav-home-link'],
            ['/session', 'nav-session-link'],
            ['/session/abc123', 'nav-session-link'],
            ['/analytics', 'nav-analytics-link'],
            ['/analytics/session-42', 'nav-analytics-link'],
        ])('marks exactly one item current on %s', (route, expectedTestId) => {
            authed();
            renderNavigation(route);

            const current = document.querySelectorAll('[aria-current="page"]');
            expect(current).toHaveLength(1);
            expect(current[0]).toBe(screen.getByTestId(expectedTestId));
            expect(current[0].className).toContain(NAV_ITEM_ACTIVE_CLASS);
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
            expect(screen.getByTestId('nav-session-link').className).not.toContain(NAV_ITEM_ACTIVE_CLASS);
        });

        it('gives active and inactive items identical geometry classes (no reflow on navigation)', () => {
            authed();
            renderNavigation('/session');

            const active = screen.getByTestId('nav-session-link');
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

            const sessionLink = screen.getByTestId('nav-session-link');
            sessionLink.focus();
            expect(document.activeElement).toBe(sessionLink);

            // jsdom applies no stylesheet, so the focus affordance is proven against the
            // stylesheet that ships with the class the element carries.
            expect(sessionLink.className).toContain(NAV_ITEM_BASE_CLASS);
            const focusBlock = navCss.match(/\.nav-item:focus-visible\s*\{([^}]*)\}/);
            expect(focusBlock?.[1]).toMatch(/outline:/);
        });

        it('does not render the duplicate mobile nav on the session page', () => {
            authed();
            renderNavigation('/session');
            expect(screen.getAllByText('Session')).toHaveLength(1);
        });

        it('decorative nav icons are hidden from assistive tech', () => {
            authed();
            renderNavigation('/analytics');
            const icons = primaryNav().querySelectorAll('svg');
            expect(icons.length).toBe(3);
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

        it('treats a "pro" status without Stripe evidence as not-yet-paid (CTA still shows)', () => {
            // status 'pro' with no Stripe/subscription id is NOT a paid entitlement; the OR clause must
            // be gated on hasPaidProEntitlement, not the bare status string. usage-limit (free) wins.
            mockUseUserProfile.mockReturnValue({ data: { subscription_status: 'pro' }, isLoading: false, error: null });
            mockUseUsageLimit.mockReturnValue({ data: { subscription_status: 'free' } });

            renderNavigation('/');

            expect(screen.getByTestId('nav-upgrade-button')).toBeInTheDocument();
        });
    });
});
