import { render, screen } from '../../../../tests/support/test-utils';
import { WeeklyActivityChart } from '../WeeklyActivityChart';
import { useAnalytics } from '@/hooks/useAnalytics';
import { describe, it, expect, vi, Mock } from 'vitest';

// Mock dependencies
vi.mock('@/hooks/useAnalytics', () => ({
    useAnalytics: vi.fn(),
}));

// Mock ResizeObserver for Recharts
global.ResizeObserver = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
};

describe('WeeklyActivityChart', () => {
    it('renders loading state', () => {
        (useAnalytics as Mock).mockReturnValue({
            sessionHistory: [],
            weekly: { status: 'loading' },
            loading: true,
            error: null,
        });

        render(<WeeklyActivityChart />);
        expect(screen.getByText('Weekly Activity')).toBeInTheDocument();
        // Skeleton should be there (difficult to test specifically without test-id, but we can verify it doesn't crash)
    });

    it('renders error state', () => {
        (useAnalytics as Mock).mockReturnValue({
            sessionHistory: [],
            weekly: { status: 'unavailable' },
            loading: false,
            error: new Error('Failed to fetch'),
        });

        render(<WeeklyActivityChart />);
        expect(screen.getByText('Could not load activity data.')).toBeInTheDocument();
    });

    it('renders chart with data', () => {
        const mockSessions = [
            { created_at: new Date().toISOString() }, // Today
        ];

        (useAnalytics as Mock).mockReturnValue({
            sessionHistory: mockSessions,
            weekly: { status: 'complete', count: 1, activity: [{ day: 'Mon', sessions: 1 }] },
            loading: false,
            error: null,
        });

        render(<WeeklyActivityChart />);
        expect(screen.getByText('Weekly Activity')).toBeInTheDocument();
        // Recharts is hard to test in unit tests, but we can verify our useMemo logic
    });

    it('#1472: an unavailable week says so instead of charting a partial page', () => {
        (useAnalytics as Mock).mockReturnValue({ sessionHistory: [], weekly: { status: 'unavailable' }, loading: false, error: null });
        render(<WeeklyActivityChart />);
        expect(screen.getByTestId('weekly-activity-unavailable')).toHaveTextContent('This week’s activity can’t load right now.');
    });
});
