import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AnalyticsPage } from '../AnalyticsPage';
import { useAuth } from '../../contexts/AuthContext';
import { useSessionManager } from '../../hooks/useSessionManager';

// Mock dependencies
vi.mock('../../contexts/AuthContext');
vi.mock('../../hooks/useSessionManager');
vi.mock('../../components/AnalyticsDashboard', () => ({
  AnalyticsDashboard: ({ sessionHistory }) => (
    <div data-testid="analytics-dashboard">
      {sessionHistory.length} session(s)
    </div>
  ),
  AnalyticsDashboardSkeleton: () => <div data-testid="analytics-skeleton" />,
}));

const mockSession = { id: 'session-1', transcript: 'Test session' };

describe('AnalyticsPage', () => {
  it('renders AnonymousAnalyticsView when user is not authenticated', () => {
    useAuth.mockReturnValue({ user: null });
    render(
      <MemoryRouter initialEntries={['/analytics']}>
        <Routes>
          <Route path="/analytics" element={<AnalyticsPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('No Session Data')).toBeInTheDocument();
  });

  it('renders AnonymousAnalyticsView with data when passed in location state', () => {
    useAuth.mockReturnValue({ user: null });
    render(
      <MemoryRouter initialEntries={[{ pathname: '/analytics', state: { sessionData: mockSession } }]}>
        <Routes>
          <Route path="/analytics" element={<AnalyticsPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('analytics-dashboard')).toHaveTextContent('1 session(s)');
  });

  it('renders AuthenticatedAnalyticsView loading skeleton when loading', () => {
    useAuth.mockReturnValue({ user: { id: 'user-1' } });
    useSessionManager.mockReturnValue({ sessions: [], loading: true });
    render(
        <MemoryRouter initialEntries={['/analytics']}>
            <Routes>
                <Route path="/analytics" element={<AnalyticsPage />} />
            </Routes>
        </MemoryRouter>
    );
    expect(screen.getByTestId('analytics-skeleton')).toBeInTheDocument();
  });

  it('renders AuthenticatedAnalyticsView with data when loaded', () => {
    useAuth.mockReturnValue({ user: { id: 'user-1' }, profile: { subscription_status: 'pro' } });
    useSessionManager.mockReturnValue({ sessions: [mockSession, mockSession], loading: false });
    render(
        <MemoryRouter initialEntries={['/analytics']}>
            <Routes>
                <Route path="/analytics" element={<AnalyticsPage />} />
            </Routes>
        </MemoryRouter>
    );
    expect(screen.getByTestId('analytics-dashboard')).toHaveTextContent('2 session(s)');
  });

  it('renders session not found message for authenticated user with invalid sessionId', () => {
    useAuth.mockReturnValue({ user: { id: 'user-1' } });
    useSessionManager.mockReturnValue({ sessions: [mockSession], loading: false });
    render(
        <MemoryRouter initialEntries={['/analytics/invalid-id']}>
            <Routes>
                <Route path="/analytics/:sessionId" element={<AnalyticsPage />} />
            </Routes>
        </MemoryRouter>
    );
    expect(screen.getByText('Session Not Found')).toBeInTheDocument();
  });
});
