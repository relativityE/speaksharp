import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent } from '../../../tests/support/test-utils';
import { AnalyticsPage } from '../AnalyticsPage';
import * as AnalyticsHook from '../../hooks/useAnalytics';
import * as AuthProvider from '../../contexts/AuthProvider';
import * as UserProfileHook from '@/hooks/useUserProfile';
import * as conversionFunnel from '@/services/conversionFunnel';
import { enablePaymentsForTest } from '../../../tests/support/payments';

// Mock modules
vi.mock('../../hooks/useAnalytics');
vi.mock('../../contexts/AuthProvider');
vi.mock('@/hooks/useUserProfile');
vi.mock('../../components/AnalyticsDashboard', () => ({
    AnalyticsDashboard: vi.fn(({ profile, loading }) => (
        <div data-testid="analytics-dashboard-mock">
            Mock Dashboard - {profile ? 'Has Profile' : 'No Profile'}
            {loading && <span data-testid="loading-indicator">Loading...</span>}
        </div>
    ))
}));

// Mock window.location.reload
const mockReload = vi.fn();
Object.defineProperty(window, 'location', {
    configurable: true,
    value: { reload: mockReload },
});

const mockUseAnalytics = vi.mocked(AnalyticsHook.useAnalytics);
const mockUseAuthProvider = vi.mocked(AuthProvider.useAuthProvider);
const mockUseUserProfile = vi.mocked(UserProfileHook.useUserProfile);

describe('AnalyticsPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Default mocks
        mockUseAnalytics.mockReturnValue({
            sessionHistory: [{ id: 'session-1', engine: 'Cloud', ground_truth: 'text', transcript: 'text', duration: 10 }],
            loading: false,
            error: null,
            refreshAnalytics: vi.fn(),
        } as unknown as ReturnType<typeof AnalyticsHook.useAnalytics>);

        mockUseAuthProvider.mockReturnValue({
            user: { id: 'test-user' },
            loading: false,
        } as unknown as AuthProvider.AuthContextType);

        mockUseUserProfile.mockReturnValue({
            data: { subscription_status: 'free' },
            isLoading: false,
            error: null,
        } as unknown as ReturnType<typeof UserProfileHook.useUserProfile>);
    });

    const renderAnalyticsPage = (initialEntry = '/analytics') => {
        // Map the initial entry to the correct path pattern
        const path = initialEntry.includes('/analytics/') ? '/analytics/:sessionId' : '/analytics';
        return render(<AnalyticsPage />, { route: initialEntry, path });
    };

    describe('Loading States', () => {
        it('should render loading state when analytics are loading', () => {
            mockUseAnalytics.mockReturnValue({
                sessionHistory: [],
                loading: true,
                error: null,
            } as unknown as ReturnType<typeof AnalyticsHook.useAnalytics>);

            renderAnalyticsPage();
            expect(screen.getByTestId('loading-indicator')).toBeInTheDocument();
        });

        it('should render loading state when profile is loading', () => {
            mockUseUserProfile.mockReturnValue({
                data: null,
                isLoading: true,
                error: null,
            } as unknown as ReturnType<typeof UserProfileHook.useUserProfile>);

            renderAnalyticsPage();
            expect(screen.getByTestId('loading-indicator')).toBeInTheDocument();
        });
    });

    describe('Error Handling', () => {
        it('should render error message when analytics fails', () => {
            mockUseAnalytics.mockReturnValue({
                sessionHistory: [],
                loading: false,
                error: { message: 'Failed to load sessions' },
            } as unknown as ReturnType<typeof AnalyticsHook.useAnalytics>);

            renderAnalyticsPage();
            expect(screen.getByText('We could not load your analytics right now. Retry sync first. If it keeps happening, sign out and back in to refresh your account session.')).toBeInTheDocument();
            expect(screen.getByText('Error Loading Analytics')).toBeInTheDocument();
        });

        it('should render error message when profile fails', () => {
            mockUseUserProfile.mockReturnValue({
                data: null,
                isLoading: false,
                error: { message: 'Failed to load profile' },
            } as unknown as ReturnType<typeof UserProfileHook.useUserProfile>);

            renderAnalyticsPage();
            expect(screen.getByText('We could not load your analytics right now. Retry sync first. If it keeps happening, sign out and back in to refresh your account session.')).toBeInTheDocument();
        });

        it('should retry analytics queries when retry button is clicked', () => {
            mockUseAnalytics.mockReturnValue({
                sessionHistory: [],
                loading: false,
                error: { message: 'Error' },
            } as unknown as ReturnType<typeof AnalyticsHook.useAnalytics>);

            renderAnalyticsPage();
            fireEvent.click(screen.getByText('Retry Analytics'));
            expect(mockReload).not.toHaveBeenCalled();
        });
    });

    describe('Dashboard View (No Session ID)', () => {
        it('#1258 D5: the page adds no heading of its own on the overview — the dashboard\'s ink header owns the h1', () => {
            renderAnalyticsPage('/analytics');
            // The dashboard is mocked here, so no heading renders at all; the real header is covered by ProgressHeader tests.
            expect(screen.queryByTestId('dashboard-heading')).toBeNull();
            expect(screen.queryByText(/Your Analytics|Track your speaking progress and improvements/)).toBeNull();
        });

        it('should render AnalyticsDashboard component', () => {
            renderAnalyticsPage('/analytics');
            expect(screen.getByTestId('analytics-dashboard-mock')).toBeInTheDocument();
        });

        it('should pass profile to AnalyticsDashboard', () => {
            renderAnalyticsPage('/analytics');
            expect(screen.getByText('Mock Dashboard - Has Profile')).toBeInTheDocument();
        });
    });

    describe('Session View (With Session ID)', () => {
        it('should render session analysis heading when session exists', () => {
            mockUseAnalytics.mockReturnValue({
                sessionHistory: [{ id: 'session-1', engine: 'Cloud', ground_truth: 'text', transcript: 'text', duration: 10 }],
                loading: false,
                error: null,
            } as unknown as ReturnType<typeof AnalyticsHook.useAnalytics>);

            renderAnalyticsPage('/analytics/session-1');
            expect(screen.getByTestId('dashboard-heading')).toHaveTextContent('Session Analysis');
            expect(screen.getByText('A detailed breakdown of your recent practice session.')).toBeInTheDocument();
        });

        it('should render "Session Not Found" when session ID does not exist in history', () => {
            mockUseAnalytics.mockReturnValue({
                sessionHistory: [],
                loading: false,
                error: null,
            } as unknown as ReturnType<typeof AnalyticsHook.useAnalytics>);

            renderAnalyticsPage('/analytics/missing-session');
            expect(screen.getByText('Session Not Found')).toBeInTheDocument();
            expect(screen.getByText("We couldn't find the session you're looking for.")).toBeInTheDocument();
        });

        it('should render link to dashboard in not found state', () => {
            mockUseAnalytics.mockReturnValue({
                sessionHistory: [],
                loading: false,
                error: null,
            } as unknown as ReturnType<typeof AnalyticsHook.useAnalytics>);

            renderAnalyticsPage('/analytics/missing-session');
            const link = screen.getByRole('link', { name: /view dashboard/i });
            expect(link).toHaveAttribute('href', '/analytics');
        });
    });

    describe('Upgrade Banner', () => {
        it('renders NO upgrade banner and emits NO checkout_started for a Free user when payments are disabled (beta default)', () => {
            const checkoutSpy = vi.spyOn(conversionFunnel, 'trackCheckoutStarted');
            mockUseUserProfile.mockReturnValue({
                data: { subscription_status: 'free' },
                isLoading: false,
                error: null,
            } as unknown as ReturnType<typeof UserProfileHook.useUserProfile>);

            renderAnalyticsPage('/analytics'); // no opt-in → fail-closed default
            expect(screen.queryByTestId('analytics-page-upgrade-button')).not.toBeInTheDocument();
            expect(checkoutSpy).not.toHaveBeenCalled();
        });

        it('should render upgrade banner for Free users on dashboard (payments enabled — local opt-in)', () => {
            enablePaymentsForTest();
            mockUseUserProfile.mockReturnValue({
                data: { subscription_status: 'free' },
                isLoading: false,
                error: null,
            } as unknown as ReturnType<typeof UserProfileHook.useUserProfile>);

            renderAnalyticsPage('/analytics');
            expect(screen.getByTestId('analytics-page-upgrade-button')).toBeInTheDocument();
            expect(screen.getByText(/turn practice into progress/i)).toBeInTheDocument();
            expect(screen.getByText(/is free for 30 days, then \$10\/month to continue\. Private transcription is on-device for everyone/i)).toBeInTheDocument();
        });

        it('should NOT render upgrade banner for pro users', () => {
            // A real paid Pro requires Stripe evidence — a bare subscription_status='pro' now reads
            // Free (guards the stale status='pro' rows), so the mock must carry a stripe id.
            mockUseUserProfile.mockReturnValue({
                data: { subscription_status: 'pro', stripe_subscription_id: 'sub_live_test' },
                isLoading: false,
                error: null,
            } as unknown as ReturnType<typeof UserProfileHook.useUserProfile>);

            renderAnalyticsPage('/analytics');
            expect(screen.queryByTestId('analytics-page-upgrade-button')).not.toBeInTheDocument();
        });

        it('should NOT render upgrade banner when viewing specific session', () => {
            mockUseUserProfile.mockReturnValue({
                data: { subscription_status: 'free' },
                isLoading: false,
                error: null,
            } as unknown as ReturnType<typeof UserProfileHook.useUserProfile>);

            renderAnalyticsPage('/analytics/session-1');
            expect(screen.queryByTestId('analytics-page-upgrade-button')).not.toBeInTheDocument();
        });
    });

    // #1573 Codex P2 4222571897: the Progress page is the app's only document.title writer. A session's product and date
    // must not outlive the page (later routes, sign-in after sign-out), and an unavailable row must not keep a stale title.
    describe('#1573: the tab title never outlives Progress or a missing session', () => {
        const APP_TITLE = /<title>([^<]+)<\/title>/.exec(readFileSync(resolve(process.cwd(), 'frontend', 'index.html'), 'utf8'))![1];
        const withSession = () => mockUseAnalytics.mockReturnValue({
            sessionHistory: [{ id: 'session-1', product: 'focus_points', created_at: '2026-10-07T18:12:00Z', duration: 10 }],
            loading: false, error: null, refreshAnalytics: vi.fn(),
        } as unknown as ReturnType<typeof AnalyticsHook.useAnalytics>);

        it('CASUALTY: leaving a session detail restores the app title (no product or date left in the tab)', () => {
            withSession();
            const { unmount } = renderAnalyticsPage('/analytics/session-1');
            expect(document.title).toMatch(/^Focus Points · .+ · Progress · SpeakSharp$/);
            unmount();
            expect(document.title).toBe(APP_TITLE);
        });

        it('CASUALTY: a detail URL whose row is unavailable shows a neutral title, never the previous session\'s', () => {
            withSession();
            document.title = 'Focus Points · 7 Oct · Progress · SpeakSharp'; // left by an earlier detail view
            renderAnalyticsPage('/analytics/missing-session');
            expect(document.title).toBe('Progress · SpeakSharp');
        });

        it('the overview title is also reset when Progress is left', () => {
            const { unmount } = renderAnalyticsPage('/analytics');
            expect(document.title).toBe('Your progress · SpeakSharp');
            unmount();
            expect(document.title).toBe(APP_TITLE);
        });
    });
});
