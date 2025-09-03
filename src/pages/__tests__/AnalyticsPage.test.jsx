import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSessionManager } from '../../hooks/useSessionManager';

// NOTE: AnalyticsPage is dynamically imported below to bust the cache.

// Mock dependencies
vi.mock('../../contexts/AuthContext');
vi.mock('../../hooks/useSessionManager');
vi.mock('../../components/AnalyticsDashboard', () => ({
  AnalyticsDashboard: ({ sessionHistory, loading, error }) => {
    if (loading) return <div data-testid="analytics-skeleton" />;
    if (error) return <div data-testid="error-display">{error.message}</div>;
    return (
      <div data-testid="analytics-dashboard">
        {sessionHistory.length} session(s)
      </div>
    );
  },
  AnalyticsDashboardSkeleton: () => <div data-testid="analytics-skeleton" />,
}));
vi.mock('@/components/SessionStatus', () => ({
  SessionStatus: () => <div data-testid="session-status" />,
}));

const mockSession = { id: 'session-1', transcript: 'Test session' };

describe('AnalyticsPage', () => {
  let AnalyticsPage;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Dynamically import the component with a cache-busting query
    const module = await import(`../AnalyticsPage.jsx?t=${Date.now()}`);
    AnalyticsPage = module.AnalyticsPage;

    // Default mocks for a non-pro user
    useAuth.mockReturnValue({
      user: { id: 'user-1' },
      profile: { subscription_status: 'free' }
    });
    useSessionManager.mockReturnValue({
      sessions: [mockSession, { ...mockSession, id: 'session-2' }],
      loading: false,
      error: null,
    });
  });

  const renderWithRouter = (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/analytics/:sessionId" element={<AnalyticsPage />} />
        </Routes>
      </MemoryRouter>
    );
  };

  it('renders AnonymousAnalyticsView when user is not authenticated', () => {
    useAuth.mockReturnValue({ user: null });
    renderWithRouter('/analytics');
    expect(screen.getByText('No Session Data')).toBeInTheDocument();
  });

  it('renders AnonymousAnalyticsView with data when passed in location state', () => {
    useAuth.mockReturnValue({ user: null });

    const Wrapper = ({ children }) => (
      <MemoryRouter initialEntries={[{ pathname: '/analytics', state: { sessionData: mockSession } }]}>
        {children}
      </MemoryRouter>
    );

    render(
      <Routes>
        <Route path="/analytics" element={<AnalyticsPage />} />
      </Routes>,
      { wrapper: Wrapper }
    );

    expect(screen.getByTestId('analytics-dashboard')).toHaveTextContent('1 session(s)');
  });

  it('renders loading skeleton when loading', () => {
    useSessionManager.mockReturnValue({ sessions: [], loading: true, error: null });
    renderWithRouter('/analytics');
    expect(screen.getByTestId('analytics-skeleton')).toBeInTheDocument();
  });

  it('renders with data when loaded', () => {
    renderWithRouter('/analytics');
    expect(screen.getByTestId('analytics-dashboard')).toHaveTextContent('2 session(s)');
  });

  it('renders session not found message for invalid sessionId', () => {
    renderWithRouter('/analytics/invalid-id');
    expect(screen.getByText('Session Not Found')).toBeInTheDocument();
  });

  it('displays the upgrade banner for non-pro users on the main dashboard', () => {
    renderWithRouter('/analytics');
    expect(screen.getByText('Unlock Your Full Potential')).toBeInTheDocument();
  });

  it('does not display the upgrade banner for pro users', () => {
    useAuth.mockReturnValue({ user: { id: 'user-1' }, profile: { subscription_status: 'pro' } });
    renderWithRouter('/analytics');
    expect(screen.queryByText('Unlock Your Full Potential')).not.toBeInTheDocument();
  });

  it('renders the correct title for the main dashboard', () => {
    renderWithRouter('/analytics');
    expect(screen.getByRole('heading', { name: 'Your Dashboard' })).toBeInTheDocument();
  });

  it('renders the correct title for a single session view', () => {
    renderWithRouter('/analytics/session-1');
    expect(screen.getByRole('heading', { name: 'Session Analysis' })).toBeInTheDocument();
    expect(screen.getByTestId('analytics-dashboard')).toHaveTextContent('1 session(s)');
  });

  it('renders developer options and allows toggling force cloud', () => {
    renderWithRouter('/analytics');
    expect(screen.getByText('Developer Options')).toBeInTheDocument();
    const checkbox = screen.getByLabelText('Force Cloud AI');
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });
});
