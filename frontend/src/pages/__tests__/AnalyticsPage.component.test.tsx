import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent } from '../../../tests/support/test-utils';
import { AnalyticsPage } from '../AnalyticsPage';
import * as AnalyticsHook from '../../hooks/useAnalytics';
import * as AuthProvider from '../../contexts/AuthProvider';
import * as UserProfileHook from '@/hooks/useUserProfile';
import * as conversionFunnel from '@/services/conversionFunnel';
import { enablePaymentsForTest } from '../../../tests/support/payments';
import { AnalyticsDashboard } from '../../components/AnalyticsDashboard';

// Mock modules
vi.mock('../../hooks/useAnalytics');
vi.mock('../../contexts/AuthProvider');
vi.mock('@/hooks/useUserProfile');
// #1472 Code P2 r4372161385: the overview-totals cases render the REAL dashboard, so the page guard is proven through what
// the person sees rather than through forwarded props. Every other case keeps the light mock.
const dashboardMode = vi.hoisted(() => ({ real: false }));
vi.mock('../../components/AnalyticsDashboard', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../components/AnalyticsDashboard')>();
    return {
        AnalyticsDashboard: vi.fn((props: ComponentProps<typeof actual.AnalyticsDashboard>) => dashboardMode.real
            ? <actual.AnalyticsDashboard {...props} />
            : (
                <div data-testid="analytics-dashboard-mock">
                    Mock Dashboard - {props.profile ? 'Has Profile' : 'No Profile'}
                    {props.loading && <span data-testid="loading-indicator">Loading...</span>}
                </div>
            )),
    };
});

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
        dashboardMode.real = false;

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
        // Map the initial entry to the correct path pattern. #1548: /progress is canonical; /analytics is the legacy alias.
        const base = initialEntry.startsWith('/progress') ? '/progress' : '/analytics';
        const path = initialEntry.startsWith(`${base}/`) ? `${base}/:sessionId` : base;
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
                allTime: { status: 'unavailable', reason: 'history_failed' },
                loading: false,
                error: { message: 'Failed to load sessions' },
            } as unknown as ReturnType<typeof AnalyticsHook.useAnalytics>);

            renderAnalyticsPage();
            expect(screen.getByText('We could not load your analytics right now. Retry sync first. If it keeps happening, sign out and back in to refresh your account session.')).toBeInTheDocument();
            expect(screen.getByText('Error Loading Progress')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Retry Progress' })).toBeInTheDocument();
            // #1254 / #1548: the page is Progress; the old Analytics labels are gone.
            expect(screen.queryByText('Error Loading Analytics')).toBeNull();
            expect(screen.queryByText('Retry Analytics')).toBeNull();
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
                allTime: { status: 'unavailable', reason: 'history_failed' },
                loading: false,
                error: { message: 'Error' },
            } as unknown as ReturnType<typeof AnalyticsHook.useAnalytics>);

            renderAnalyticsPage();
            fireEvent.click(screen.getByText('Retry Progress'));
            expect(mockReload).not.toHaveBeenCalled();
        });
    });

    // #1472 Code P2 r4372161385: useAnalytics keeps a complete server aggregate through a recent-history failure, but the page
    // used to return its whole-page error before the dashboard mounted, so the person lost every total anyway.
    describe('#1472: a recent-history failure does not hide complete all-time totals on the overview', () => {
        const historyError = { message: 'recent history failed' };
        const completeAllTime = {
            status: 'complete',
            stats: {
                totalSessions: 37, averageWPM: 131, avgFillerWordsPerMin: 2, totalPracticeTime: 222, totalPracticeTimeSeconds: 13320,
                averageSessionLength: 6, averageSessionLengthSeconds: 360, avgClarity: 88, avgPausesPerMin: 7, chartData: [],
            },
        } as const;
        const withAnalytics = (over: Record<string, unknown>) => mockUseAnalytics.mockReturnValue({
            sessionHistory: [], allTime: completeAllTime, firstSessionAt: '2026-09-01T10:00:00Z', loading: false, error: historyError, ...over,
        } as unknown as ReturnType<typeof AnalyticsHook.useAnalytics>);

        beforeEach(() => { dashboardMode.real = true; });

        it('CASUALTY: the overview shows its complete totals and says the recent sessions cannot load', () => {
            withAnalytics({});
            renderAnalyticsPage('/progress');
            expect(screen.queryByText('Error Loading Progress')).toBeNull();
            expect(screen.queryByText('Error Loading Analytics')).toBeNull();
            expect(screen.getByTestId('analytics-recent-history-unavailable')).toHaveTextContent('Your recent sessions can’t load right now');
            expect(screen.getByTestId('stat-card-total_sessions')).toHaveTextContent('37');
            expect(screen.getByTestId('progress-header-line')).toHaveTextContent(/You've done 37 sessions since/);
            // The dashboard receives the original history error, which is what makes its warning truthful.
            const props = vi.mocked(AnalyticsDashboard).mock.calls[vi.mocked(AnalyticsDashboard).mock.calls.length - 1]?.[0];
            expect(props?.error).toBe(historyError);
        });

        it('CONTROL a profile failure still fails the whole page', () => {
            withAnalytics({});
            mockUseUserProfile.mockReturnValue({
                data: null, isLoading: false, error: { message: 'Failed to load profile' },
            } as unknown as ReturnType<typeof UserProfileHook.useUserProfile>);
            renderAnalyticsPage('/progress');
            expect(screen.getByText('Error Loading Progress')).toBeInTheDocument();
            expect(screen.queryByTestId('stat-card-total_sessions')).toBeNull();
        });

        it('CONTROL a session detail with a history failure still fails the whole page', () => {
            withAnalytics({});
            renderAnalyticsPage('/progress/session-1');
            expect(screen.getByText('Error Loading Progress')).toBeInTheDocument();
            expect(screen.queryByText('Session Not Found')).toBeNull();
            expect(screen.queryByTestId('stat-card-total_sessions')).toBeNull();
        });

        it.each([
            ['unavailable', { status: 'unavailable', reason: 'history_failed' }],
            ['loading', { status: 'loading' }],
        ])('CONTROL an %s aggregate with a history failure still fails the whole page', (_label, allTime) => {
            withAnalytics({ allTime });
            renderAnalyticsPage('/progress');
            expect(screen.getByText('Error Loading Progress')).toBeInTheDocument();
            expect(screen.queryByTestId('stat-card-total_sessions')).toBeNull();
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

        it('#1472: threads the all-time aggregate from useAnalytics into the dashboard unchanged', () => {
            const allTime = { status: 'unavailable', reason: 'summary_failed' } as const;
            mockUseAnalytics.mockReturnValue({
                sessionHistory: [], allTime, loading: false, error: null,
            } as unknown as ReturnType<typeof AnalyticsHook.useAnalytics>);
            renderAnalyticsPage('/analytics');
            const props = vi.mocked(AnalyticsDashboard).mock.calls[vi.mocked(AnalyticsDashboard).mock.calls.length - 1]?.[0];
            expect(props?.allTime).toEqual(allTime);
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
            expect(link).toHaveAttribute('href', '/progress');
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
