import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AnalyticsPage } from '../AnalyticsPage';
import { useAuth } from '../../contexts/AuthContext';
import { useSession } from '../../contexts/SessionContext';
import { IS_DEV } from '../../config';

// Mock dependencies
vi.mock('../../contexts/AuthContext');
vi.mock('../../contexts/SessionContext');
vi.mock('../../config', () => ({
    IS_DEV: true,
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const original = await vi.importActual('react-router-dom');
    return {
        ...original,
        useNavigate: () => mockNavigate,
    };
});

const renderWithRouter = (ui, { initialEntries = ['/analytics'] } = {}) => {
    return render(
        <MemoryRouter initialEntries={initialEntries}>
            <Routes>
                <Route path="/analytics" element={ui} />
                <Route path="/analytics/:sessionId" element={ui} />
            </Routes>
        </MemoryRouter>
    );
};

describe('AnalyticsPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders AnonymousAnalyticsView with no data when user is anonymous and has no history', () => {
        useAuth.mockReturnValue({ user: null });
        renderWithRouter(<AnalyticsPage />, { initialEntries: ['/analytics'] });
        expect(screen.getByText('No Session Data')).toBeInTheDocument();
    });

    it('renders dashboard with data for an anonymous user with a temporary session', () => {
        useAuth.mockReturnValue({ user: null });
        const mockSessionData = { id: 'anon-123', transcript: 'temp data', filler_words: {}, duration: 120, accuracy: 0.95 };
        renderWithRouter(<AnalyticsPage />, { initialEntries: [{ pathname: '/analytics', state: { sessionData: mockSessionData } }] });
        expect(screen.getByText('Session Analysis')).toBeInTheDocument();
        expect(screen.getByTestId('stat-card-total-sessions')).toBeInTheDocument();
    });

    it('renders loading skeleton when session context is loading', () => {
        useAuth.mockReturnValue({ user: { id: 'test-user' }, profile: {} });
        useSession.mockReturnValue({ sessionHistory: [], loading: true, error: null });
        renderWithRouter(<AnalyticsPage />);
        expect(screen.getByTestId('analytics-dashboard-skeleton')).toBeInTheDocument();
    });

    it('renders the dashboard with data for an authenticated user', () => {
        useAuth.mockReturnValue({ user: { id: 'test-user' }, profile: { subscription_status: 'free' } });
        useSession.mockReturnValue({
            sessionHistory: [{ id: '1', transcript: 'test', filler_words: {}, duration: 60, accuracy: 0.9 }],
            loading: false,
            error: null,
        });
        renderWithRouter(<AnalyticsPage />);
        expect(screen.getByText('Your Dashboard')).toBeInTheDocument();
    });

    it('renders a specific session view when a sessionId is in the URL', () => {
        useAuth.mockReturnValue({ user: { id: 'test-user' }, profile: { subscription_status: 'pro' } });
        useSession.mockReturnValue({
            sessionHistory: [{ id: 'session-123', transcript: 'specific session', filler_words: {}, duration: 180, accuracy: 0.88 }],
            loading: false,
            error: null,
        });
        renderWithRouter(<AnalyticsPage />, { initialEntries: ['/analytics/session-123'] });
        expect(screen.getByText('Session Analysis')).toBeInTheDocument();
    });

    it('renders session not found message for an invalid sessionId', () => {
        useAuth.mockReturnValue({ user: { id: 'test-user' }, profile: { subscription_status: 'pro' } });
        useSession.mockReturnValue({
            sessionHistory: [{ id: 'session-123', transcript: 'a session' }],
            loading: false,
            error: null,
        });
        renderWithRouter(<AnalyticsPage />, { initialEntries: ['/analytics/invalid-id'] });
        expect(screen.getByText('Session Not Found')).toBeInTheDocument();
    });
});
