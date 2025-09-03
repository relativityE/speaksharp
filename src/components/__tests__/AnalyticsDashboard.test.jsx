import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AnalyticsDashboard } from '../AnalyticsDashboard';
import '@testing-library/jest-dom';

import * as analyticsUtils from '../../lib/analyticsUtils';
import * as FillerWordTableModule from '../analytics/FillerWordTable';

// Mock child components and utils
vi.mock('../ErrorDisplay', () => ({
  ErrorDisplay: ({ error }) => <div data-testid="error-display">{error.message}</div>,
}));

vi.mock('react-router-dom', () => ({
  ...vi.importActual('react-router-dom'),
  useNavigate: () => vi.fn(),
}));

describe('AnalyticsDashboard', () => {
  const mockSessionHistory = [
    { id: 1, created_at: new Date().toISOString(), duration: 60, filler_words: { um: { count: 1 } }, accuracy: 0.9, title: 'Test Session' },
  ];
  const mockProfile = { subscription_status: 'pro' };

  it('renders skeleton when loading', () => {
    const { container } = render(<AnalyticsDashboard loading={true} />);
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

  it('renders the dashboard with data and the new FillerWordTable', () => {
    const mockStats = {
        totalSessions: 5,
        avgFillerWordsPerMin: '3.2',
        totalPracticeTime: 120,
        avgAccuracy: '95.5',
        chartData: [{ date: '2023-01-01', 'FW/min': 3.2 }],
    };
    const mockTrends = {
        'um': [{ count: 5, severity: 'yellow', tooltip: '50% increase' }],
    };
    vi.spyOn(analyticsUtils, 'calculateOverallStats').mockReturnValue(mockStats);
    vi.spyOn(analyticsUtils, 'calculateFillerWordTrends').mockReturnValue(mockTrends);
    vi.spyOn(FillerWordTableModule, 'FillerWordTable').mockImplementation(({ trendData }) => (
        <div data-testid="filler-word-table">
            <pre>{JSON.stringify(trendData)}</pre>
        </div>
    ));

    render(<AnalyticsDashboard sessionHistory={mockSessionHistory} profile={mockProfile} loading={false} error={null} />);

    // Check that stat cards are rendered with data from our mocked util
    const totalSessionsCard = screen.getByTestId('stat-card-total-sessions');
    expect(within(totalSessionsCard).getByText('Total Sessions')).toBeInTheDocument();
    expect(within(totalSessionsCard).getByText('5')).toBeInTheDocument();

    const avgFwCard = screen.getByTestId('stat-card-avg.-filler-words-/-min');
    expect(within(avgFwCard).getByText('3.2')).toBeInTheDocument();

    // Check that the FillerWordTable is rendered
    const fillerTable = screen.getByTestId('filler-word-table');
    expect(fillerTable).toBeInTheDocument();

    // Check that the correct data was passed to the FillerWordTable
    expect(fillerTable).toHaveTextContent(JSON.stringify(mockTrends));
  });
});
