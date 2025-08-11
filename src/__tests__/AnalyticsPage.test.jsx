import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { AnalyticsPage } from '../pages/AnalyticsPage';
import { useAuth } from '../contexts/AuthContext';
import { useSessionManager } from '../hooks/useSessionManager';

// Mock hooks
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useSessionManager');

// Mock child components
vi.mock('../components/AnalyticsDashboard', () => ({
    AnalyticsDashboard: ({ sessionHistory }) => (
        <div data-testid="analytics-dashboard">
            {sessionHistory.length} sessions
        </div>
    ),
}));

const renderAnalyticsPage = (authState) => {
    useAuth.mockReturnValue(authState);
    return render(
        <MemoryRouter>
            <AnalyticsPage />
        </MemoryRouter>
    );
};

describe('AnalyticsPage', () => {
    beforeEach(() => {
        // Default mock for session manager
        useSessionManager.mockReturnValue({
            sessions: [],
            exportSessions: vi.fn(),
            loading: false,
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
        cleanup();
    });

    describe('when user is not authenticated', () => {
        it('renders a call-to-action to sign up', () => {
            renderAnalyticsPage({ user: null });
            expect(screen.getByText('Unlock Your Full Potential')).toBeInTheDocument();
            expect(screen.getByRole('link', { name: /sign up for free/i })).toBeInTheDocument();
        });

        it('shows a disabled preview of the dashboard', () => {
            renderAnalyticsPage({ user: null });
            expect(screen.getByText('Your future dashboard')).toBeInTheDocument();
            const dashboard = screen.getByTestId('analytics-dashboard');
            expect(dashboard).toBeInTheDocument();
            expect(dashboard.parentElement).toHaveClass('opacity-50');
        });
    });

    describe('when user is authenticated', () => {
        const mockUser = { id: '123', email: 'test@example.com' };
        const mockSessions = [{ id: 's1', duration: 60 }, { id: 's2', duration: 90 }];

        it('renders the authenticated view with user data', () => {
            useSessionManager.mockReturnValue({
                sessions: mockSessions,
                exportSessions: vi.fn(),
                loading: false,
            });
            renderAnalyticsPage({ user: mockUser });

            expect(screen.getByText('Your Analytics')).toBeInTheDocument();
            const dashboard = screen.getByTestId('analytics-dashboard');
            expect(dashboard).toBeInTheDocument();
            expect(dashboard).toHaveTextContent('2 sessions');
        });

        it('shows a loading state while fetching data', () => {
            useSessionManager.mockReturnValue({
                sessions: [],
                exportSessions: vi.fn(),
                loading: true,
            });
            renderAnalyticsPage({ user: mockUser });
            expect(screen.getByText('Loading analytics...')).toBeInTheDocument();
        });
    });
});
