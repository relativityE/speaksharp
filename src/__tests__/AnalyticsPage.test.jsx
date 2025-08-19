import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AnalyticsPage } from '../pages/AnalyticsPage';
import { useSessionManager } from '../hooks/useSessionManager';

// Mock the AnalyticsDashboard module with both exports
vi.mock('../components/AnalyticsDashboard', () => ({
  AnalyticsDashboard: () => <div data-testid="analytics-dashboard" />,
  AnalyticsDashboardSkeleton: () => <div data-testid="analytics-dashboard-skeleton" />,
}));

// Mock the auth hook
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: 'Test User' },
  }),
}));

vi.mock('../hooks/useSessionManager');

const renderWithRouter = (component) => {
  return render(
    <BrowserRouter>
      {component}
    </BrowserRouter>
  );
};

describe('AnalyticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should display loading skeleton while analytics are loading', () => {
    useSessionManager.mockReturnValue({ sessions: [], loading: true });
    renderWithRouter(<AnalyticsPage />);

    // Check that the loading skeleton is displayed
    expect(screen.getByTestId('analytics-dashboard-skeleton')).toBeInTheDocument();
  });

  it('should display analytics dashboard after loading', async () => {
    useSessionManager.mockReturnValue({ sessions: [ {id: '1'} ], loading: false });
    renderWithRouter(<AnalyticsPage />);

    // Wait for loading to complete and dashboard to appear
    await waitFor(() => {
      expect(screen.getByTestId('analytics-dashboard')).toBeInTheDocument();
    });
  });
});
