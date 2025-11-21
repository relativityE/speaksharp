import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AnalyticsDashboard } from '@/components/AnalyticsDashboard';
import { BrowserRouter } from 'react-router-dom';

// Mocks
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => vi.fn(),
    };
});

vi.mock('@/lib/pdfGenerator', () => ({ generateSessionPdf: vi.fn() }));
vi.mock('@/lib/analyticsUtils', () => ({
    calculateOverallStats: vi.fn().mockReturnValue({
        totalSessions: 1,
        avgWpm: 120,
        avgFillerWordsPerMin: 2.5,
        totalPracticeTime: 10,
        avgAccuracy: '95.0',
        chartData: [{ date: '2023-01-01', 'FW/min': 2.5 }],
    }),
    calculateFillerWordTrends: vi.fn().mockReturnValue([]),
}));

// Mock child components to isolate the dashboard
vi.mock('@/components/analytics/AccuracyComparison', () => ({
    AccuracyComparison: () => <div data-testid="accuracy-comparison-mock" />,
}));
vi.mock('@/components/analytics/TopFillerWords', () => ({
    TopFillerWords: () => <div data-testid="top-filler-words-mock" />,
}));
vi.mock('@/components/analytics/FillerWordTable', () => ({
    FillerWordTable: () => <div data-testid="filler-word-table-mock" />,
}));

// Mock Recharts to avoid ResponsiveContainer width/height warnings
vi.mock('recharts', async () => {
    const OriginalModule = await vi.importActual('recharts');
    return {
        ...OriginalModule,
        ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
            <div style={{ width: 800, height: 300 }}>{children}</div>
        ),
    };
});

// Test Data
const mockSession = {
    id: '1',
    user_id: 'user-123',
    created_at: new Date().toISOString(),
    title: 'Test Session',
    duration: 600,
    total_words: 1200,
    accuracy: 0.95,
    filler_words: { 'um': { count: 5 } },
};

const mockProfile = {
    id: '1',
    email: 'test@example.com',
    subscription_status: 'free' as 'free' | 'pro',
};

const renderWithRouter = (ui: React.ReactElement, { route = '/' } = {}) => {
    window.history.pushState({}, 'Test page', route)
    return render(ui, { wrapper: BrowserRouter })
}

describe('AnalyticsDashboard', () => {
    it('renders the skeleton when loading', () => {
        renderWithRouter(<AnalyticsDashboard sessionHistory={[]} profile={null} loading={true} error={null} />);
        expect(screen.getByTestId('analytics-dashboard-skeleton')).toBeInTheDocument();
    });

    it('renders the error display when there is an error', () => {
        const error = new Error('Failed to load data');
        renderWithRouter(<AnalyticsDashboard sessionHistory={[]} profile={null} loading={false} error={error} />);

        // Corrected Assertion: Check for the title from ErrorDisplay and the specific message
        expect(screen.getByText('An Error Occurred')).toBeInTheDocument();
        expect(screen.getByText('Failed to load data')).toBeInTheDocument();
    });

    it('renders the empty state when there is no session history', () => {
        renderWithRouter(<AnalyticsDashboard sessionHistory={[]} profile={mockProfile} loading={false} error={null} />);
        expect(screen.getByText('Your Dashboard Awaits!')).toBeInTheDocument();
        expect(screen.getByText('Start a New Session →')).toBeInTheDocument();
    });

    it('renders the dashboard with data when session history is provided', () => {
        renderWithRouter(<AnalyticsDashboard sessionHistory={[mockSession]} profile={mockProfile} loading={false} error={null} />);
        expect(screen.getByTestId('stat-card-total-sessions')).toHaveTextContent('1');
        expect(screen.getByTestId('speaking-pace')).toHaveTextContent('120');
        expect(screen.getByTestId('avg-filler-words-min')).toHaveTextContent('2.5');
        expect(screen.getByTestId('total-practice-time')).toHaveTextContent('10');
        expect(screen.getByTestId('avg-accuracy')).toHaveTextContent('95.0');
        expect(screen.getByTestId('session-history-item')).toBeInTheDocument();
    });

    it('shows the upgrade prompt for non-pro users', () => {
        renderWithRouter(<AnalyticsDashboard sessionHistory={[mockSession]} profile={mockProfile} loading={false} error={null} />);
        expect(screen.getByTestId('analytics-dashboard-upgrade-button')).toBeInTheDocument();
    });

    it('hides the upgrade prompt for pro users', () => {
        const proProfile = { ...mockProfile, subscription_status: 'pro' as const };
        renderWithRouter(<AnalyticsDashboard sessionHistory={[mockSession]} profile={proProfile} loading={false} error={null} />);
        expect(screen.queryByTestId('analytics-dashboard-upgrade-button')).not.toBeInTheDocument();
    });
});
