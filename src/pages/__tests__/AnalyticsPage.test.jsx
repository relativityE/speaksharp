import { render, screen } from '../../test/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnalyticsPage } from '../AnalyticsPage';
import { useAuth } from '../../contexts/AuthContext';
import { useSession } from '../../contexts/SessionContext';

// Mock dependencies
vi.mock('../../contexts/AuthContext');
vi.mock('../../contexts/SessionContext');
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
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders AnonymousAnalyticsView with no data when user is anonymous and has no history', () => {
        useAuth.mockReturnValue({ user: null });
        useSession.mockReturnValue({ sessionHistory: [], loading: false, error: null });
        render(<AnalyticsPage />, { route: '/analytics' });
        expect(screen.getByText('No Session Data')).toBeInTheDocument();
    });

    it('renders dashboard with data for an anonymous user with a temporary session', async () => {
        useAuth.mockReturnValue({ user: null });
        useSession.mockReturnValue({ sessionHistory: [], loading: false, error: null });
        const mockSessionData = { id: 'anon-123', transcript: 'temp data', filler_words: { um: 1 }, duration: 120, accuracy: 0.95 };

        render(<AnalyticsPage />, {
            route: {
                pathname: '/analytics',
                state: { sessionData: mockSessionData },
            },
        });

        expect(await screen.findByText('Session Analysis')).toBeInTheDocument();
        expect(await screen.findByTestId('stat-card-filler-words')).toBeInTheDocument();
    });

    it('renders loading skeleton when session context is loading', () => {
        useAuth.mockReturnValue({ user: { id: 'test-user' }, profile: {} });
        useSession.mockReturnValue({ sessionHistory: [], loading: true, error: null });
        render(<AnalyticsPage />, { route: '/analytics' });
        expect(screen.getByTestId('analytics-dashboard-skeleton')).toBeInTheDocument();
    });

    it('renders the dashboard with data for an authenticated user', () => {
        useAuth.mockReturnValue({ user: { id: 'test-user' }, profile: { subscription_status: 'free' } });
        useSession.mockReturnValue({
            sessionHistory: [{ id: '1', transcript: 'test', filler_words: {}, duration: 60, accuracy: 0.9 }],
            loading: false,
            error: null,
        });
        render(<AnalyticsPage />, { route: '/analytics' });
        expect(screen.getByText('Your Dashboard')).toBeInTheDocument();
    });

    it('renders a specific session view when a sessionId is in the URL', () => {
        useAuth.mockReturnValue({ user: { id: 'test-user' }, profile: { subscription_status: 'pro' } });
        useSession.mockReturnValue({
            sessionHistory: [{ id: 'session-123', transcript: 'specific session', filler_words: {}, duration: 180, accuracy: 0.88 }],
            loading: false,
            error: null,
        });
        render(<AnalyticsPage />, { route: '/analytics/session-123' });
        expect(screen.getByText('Session Analysis')).toBeInTheDocument();
    });

    it('renders session not found message for an invalid sessionId', () => {
        useAuth.mockReturnValue({ user: { id: 'test-user' }, profile: { subscription_status: 'pro' } });
        useSession.mockReturnValue({
            sessionHistory: [{ id: 'session-123', transcript: 'a session' }],
            loading: false,
            error: null,
        });
        render(<AnalyticsPage />, { route: '/analytics/invalid-id' });
        expect(screen.getByText('Session Not Found')).toBeInTheDocument();
    });
});
