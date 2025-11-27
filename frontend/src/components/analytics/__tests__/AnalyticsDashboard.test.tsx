import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import { AnalyticsDashboard } from '../../AnalyticsDashboard';
import { useAnalytics } from '@/hooks/useAnalytics';

// Mock canvas to avoid native dependency errors in test environment
vi.mock('canvas', () => ({
    createCanvas: vi.fn(() => ({
        getContext: vi.fn(() => ({
            drawImage: vi.fn(),
            fillRect: vi.fn(),
        })),
        toBuffer: vi.fn(() => Buffer.from('mock-canvas-buffer')),
    })),
    loadImage: vi.fn().mockResolvedValue({
        width: 100,
        height: 100,
    }),
}));

// Mock useAnalytics
vi.mock('@/hooks/useAnalytics');

// Mock child components to isolate dashboard testing
vi.mock('../../analytics/AccuracyComparison', () => ({
    AccuracyComparison: () => <div data-testid="accuracy-comparison">Accuracy Comparison</div>
}));
vi.mock('../../analytics/WeeklyActivityChart', () => ({
    WeeklyActivityChart: () => <div data-testid="weekly-activity-chart">Weekly Activity Chart</div>
}));
vi.mock('../../analytics/GoalsSection', () => ({
    GoalsSection: () => <div data-testid="goals-section">Goals Section</div>
}));
vi.mock('../../analytics/TopFillerWords', () => ({
    TopFillerWords: () => <div data-testid="top-filler-words">Top Filler Words</div>
}));
vi.mock('../../analytics/FillerWordTable', () => ({
    FillerWordTable: () => <div data-testid="filler-word-table">Filler Word Table</div>
}));

// Mock Supabase client
const mockInvoke = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: () => ({
        functions: {
            invoke: mockInvoke
        }
    })
}));

// Mock window.location
const mockLocation = { href: '' };
Object.defineProperty(window, 'location', {
    value: mockLocation,
    writable: true
});

describe('AnalyticsDashboard', () => {
    const mockProfile = {
        id: '123',
        email: 'test@example.com',
        subscription_status: 'free' as const
    };

    const mockSessionHistory = [
        {
            id: '1',
            user_id: '123',
            created_at: '2023-10-27T10:00:00Z',
            title: 'Test Session',
            duration: 60,
            total_words: 150,
            accuracy: 0.95,
            filler_words: { um: { count: 2 } }
        }
    ];

    const mockAnalyticsData = {
        sessionHistory: mockSessionHistory,
        overallStats: {
            totalSessions: 1,
            totalPracticeTime: 1,
            avgWpm: 150,
            avgFillerWordsPerMin: "2.0",
            avgAccuracy: "95.0",
            chartData: []
        },
        fillerWordTrends: {},
        topFillerWords: [],
        accuracyData: [],
        loading: false,
        error: null
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (useAnalytics as Mock).mockReturnValue(mockAnalyticsData);
    });

    it('renders loading skeleton when loading is true', () => {
        (useAnalytics as Mock).mockReturnValue({ ...mockAnalyticsData, loading: true });
        render(<BrowserRouter><AnalyticsDashboard profile={mockProfile} /></BrowserRouter>);
        expect(screen.getByTestId('analytics-dashboard-skeleton')).toBeInTheDocument();
    });

    it('renders error display when error is present', () => {
        (useAnalytics as Mock).mockReturnValue({ ...mockAnalyticsData, error: new Error('Test error') });
        render(<BrowserRouter><AnalyticsDashboard profile={mockProfile} /></BrowserRouter>);
        expect(screen.getByText('An Error Occurred')).toBeInTheDocument();
        expect(screen.getByText('Test error')).toBeInTheDocument();
    });

    it('renders empty state when no sessions exist', () => {
        (useAnalytics as Mock).mockReturnValue({ ...mockAnalyticsData, sessionHistory: [] });
        render(<BrowserRouter><AnalyticsDashboard profile={mockProfile} /></BrowserRouter>);
        expect(screen.getByTestId('analytics-dashboard-empty-state')).toBeInTheDocument();
    });

    it('renders dashboard content when data is present', () => {
        render(<BrowserRouter><AnalyticsDashboard profile={mockProfile} /></BrowserRouter>);
        expect(screen.getByTestId('stat-card-total-sessions')).toBeInTheDocument();
        expect(screen.getByTestId('session-history-item')).toBeInTheDocument();
    });

    it('renders upgrade banner for free users', () => {
        render(<BrowserRouter><AnalyticsDashboard profile={mockProfile} /></BrowserRouter>);
        expect(screen.getByTestId('analytics-dashboard-upgrade-button')).toBeInTheDocument();
    });

    it('does not render upgrade banner for pro users', () => {
        render(<BrowserRouter><AnalyticsDashboard profile={{ ...mockProfile, subscription_status: 'pro' }} /></BrowserRouter>);
        expect(screen.queryByTestId('analytics-dashboard-upgrade-button')).not.toBeInTheDocument();
    });
});
