import { render, screen } from '../../test/test-utils';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { AnalyticsPage } from '../AnalyticsPage';

vi.mock('../../config', () => ({
    IS_DEV: true,
    FILLER_WORD_KEYS: {
        "uh": "uh",
        "um": "um",
        "like": "like",
        "you know": "you know",
    }
}));

describe('AnalyticsPage', () => {
    // These tests pass fine with fake timers
    it('renders AnonymousAnalyticsView with no data when user is anonymous and has no history', () => {
        const authMock = { user: null, profile: null, loading: false };
        render(<AnalyticsPage />, { authMock, route: '/analytics' });
        expect(screen.getByText('No Session Data')).toBeInTheDocument();
    });

    it('renders loading skeleton when session context is loading', () => {
        const authMock = { user: { id: 'test-user' }, profile: {}, loading: false };
        const sessionMock = { sessionHistory: [], loading: true, error: null };
        const { container } = render(<AnalyticsPage />, { authMock, sessionMock, route: '/analytics' });
        expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('renders the dashboard with data for an authenticated user', () => {
        const authMock = { user: { id: 'test-user' }, profile: { subscription_status: 'free' }, loading: false };
        const sessionMock = {
            sessionHistory: [{ id: '1', transcript: 'test', filler_words: {}, duration: 60, accuracy: 0.9 }],
            loading: false,
            error: null,
        };
        render(<AnalyticsPage />, { authMock, sessionMock, route: '/analytics' });
        expect(screen.getByText('Your Dashboard')).toBeInTheDocument();
    });

    // These tests were timing out. Let's run them with real timers.
    describe('with real timers', () => {
        beforeAll(() => {
            vi.useRealTimers();
        });

        afterAll(() => {
            vi.useFakeTimers();
        });

        it('renders dashboard with data for an anonymous user with a temporary session', async () => {
            const authMock = { user: null, profile: null, loading: false };
            const mockSession = { id: 'anon-123', transcript: 'temp data', filler_words: { um: 1 }, duration: 120, accuracy: 0.95 };

            render(<AnalyticsPage />, {
                authMock,
                route: {
                    pathname: '/analytics',
                    state: { sessionHistory: [mockSession] },
                },
            });

            expect(await screen.findByText('Session Analysis', {}, { timeout: 5000 })).toBeInTheDocument();
            expect(await screen.findByTestId('total-practice-time', {}, { timeout: 5000 })).toBeInTheDocument();
        });

        it('renders a specific session view when a sessionId is in the URL', async () => {
            const authMock = { user: { id: 'test-user' }, profile: { subscription_status: 'pro' }, loading: false };
            const sessionMock = {
                sessionHistory: [{ id: 'session-123', transcript: 'specific session', filler_words: {}, duration: 180, accuracy: 0.88 }],
                loading: false,
                error: null,
            };
            render(<AnalyticsPage />, { authMock, sessionMock, route: '/analytics/session-123' });
            expect(await screen.findByText('Session Analysis', {}, { timeout: 5000 })).toBeInTheDocument();
        });

        it('renders session not found message for an invalid sessionId', async () => {
            const authMock = { user: { id: 'test-user' }, profile: { subscription_status: 'pro' }, loading: false };
            const sessionMock = {
                sessionHistory: [{ id: 'session-123', transcript: 'a session' }],
                loading: false,
                error: null,
            };
            render(<AnalyticsPage />, { authMock, sessionMock, route: '/analytics/invalid-id' });
            expect(await screen.findByText('Session Not Found', {}, { timeout: 5000 })).toBeInTheDocument();
        });
    });
});
