import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AnalyticsPage } from '../AnalyticsPage';
import * as AnalyticsHook from '../../hooks/useAnalytics';
import * as AuthProvider from '../../contexts/AuthProvider';
import * as UserProfileHook from '@/hooks/useUserProfile';

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
            sessionHistory: [{ id: 'session-1' }],
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
        return render(
            <MemoryRouter initialEntries={[initialEntry]}>
                <Routes>
                    <Route path="/analytics" element={<AnalyticsPage />} />
                    <Route path="/analytics/:sessionId" element={<AnalyticsPage />} />
                </Routes>
            </MemoryRouter>
        );
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
            expect(screen.getByText('Failed to load sessions')).toBeInTheDocument();
            expect(screen.getByText('Error Loading Analytics')).toBeInTheDocument();
        });

        it('should render error message when profile fails', () => {
            mockUseUserProfile.mockReturnValue({
                data: null,
                isLoading: false,
                error: { message: 'Failed to load profile' },
            } as unknown as ReturnType<typeof UserProfileHook.useUserProfile>);

            renderAnalyticsPage();
            expect(screen.getByText('Failed to load profile')).toBeInTheDocument();
        });

        it('should reload page when refresh button is clicked', () => {
            mockUseAnalytics.mockReturnValue({
                sessionHistory: [],
                loading: false,
                error: { message: 'Error' },
            } as unknown as ReturnType<typeof AnalyticsHook.useAnalytics>);

            renderAnalyticsPage();
            fireEvent.click(screen.getByText('Refresh Page'));
            expect(mockReload).toHaveBeenCalled();
        });
    });

    describe('Dashboard View (No Session ID)', () => {
        it('should render dashboard heading', () => {
            renderAnalyticsPage('/analytics');
            expect(screen.getByTestId('dashboard-heading')).toHaveTextContent('Your Analytics');
            expect(screen.getByText('Track your speaking progress and improvements')).toBeInTheDocument();
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
                sessionHistory: [{ id: 'session-1' }],
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
        it('should render upgrade banner for free users on dashboard', () => {
            mockUseUserProfile.mockReturnValue({
                data: { subscription_status: 'free' },
                isLoading: false,
                error: null,
            } as unknown as ReturnType<typeof UserProfileHook.useUserProfile>);

            renderAnalyticsPage('/analytics');
            expect(screen.getByTestId('analytics-page-upgrade-button')).toBeInTheDocument();
        });

        it('should NOT render upgrade banner for pro users', () => {
            mockUseUserProfile.mockReturnValue({
                data: { subscription_status: 'pro' },
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
});
