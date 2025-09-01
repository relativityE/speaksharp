import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AnalyticsDashboard } from '../AnalyticsDashboard';

// Mock ResizeObserver for recharts
const ResizeObserverMock = vi.fn(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));
vi.stubGlobal('ResizeObserver', ResizeObserverMock);

// Mocks
vi.mock('../ErrorDisplay', () => ({
  ErrorDisplay: ({ error }) => <div data-testid="error-display">{error.message}</div>,
}));

vi.mock('react-router-dom', () => ({
  ...vi.importActual('react-router-dom'),
  useNavigate: () => vi.fn(),
}));

describe('AnalyticsDashboard', () => {
  it('renders skeleton when loading', () => {
    const { container } = render(<AnalyticsDashboard loading={true} />);
    // The skeleton component adds the animate-pulse class to its root
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders error display when an error is provided', () => {
    const error = { message: 'Failed to load data' };
    render(<AnalyticsDashboard error={error} />);
    expect(screen.getByTestId('error-display')).toBeInTheDocument();
    expect(screen.getByText('Failed to load data')).toBeInTheDocument();
  });

  it('renders empty state when there is no session history', () => {
    render(<AnalyticsDashboard sessionHistory={[]} loading={false} error={null} />);
    expect(screen.getByText('Your Dashboard Awaits!')).toBeInTheDocument();
  });

  it('renders the dashboard with data when session history is provided', () => {
    const sessionHistory = [
      { id: 1, created_at: new Date().toISOString(), duration: 60, filler_words: { um: { count: 1 } }, accuracy: 0.9, title: 'Test Session' },
    ];
    const profile = { subscription_status: 'pro' };
    render(<AnalyticsDashboard sessionHistory={sessionHistory} profile={profile} loading={false} error={null} />);

    // Check for the "Total Sessions" card and assert its content specifically
    const totalSessionsCard = screen.getByTestId('stat-card-total-sessions');
    expect(within(totalSessionsCard).getByText('Total Sessions')).toBeInTheDocument();
    expect(within(totalSessionsCard).getByText('1')).toBeInTheDocument();

    // Check that other parts of the dashboard are rendered
    expect(screen.getByText('Session History')).toBeInTheDocument();
  });
});
