import { render, screen } from '@testing-library/react';
import { AnalyticsDashboard } from '../AnalyticsDashboard';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import React from 'react';
import type { UserProfile } from '@/types/user';

// Mock dependencies
vi.mock('../../lib/pdfGenerator', () => ({
    generateSessionPdf: vi.fn(),
}));

// Mock sub-components explicitly to ensure isolation
vi.mock('../analytics/STTAccuracyComparison', () => ({ STTAccuracyComparison: () => <div data-testid="accuracy-comparison" /> }));
vi.mock('../analytics/WeeklyActivityChart', () => ({ WeeklyActivityChart: () => <div data-testid="weekly-activity-chart" /> }));
vi.mock('../analytics/GoalsSection', () => ({ GoalsSection: () => <div data-testid="goals-section" /> }));
vi.mock('../analytics/TopFillerWords', () => ({ TopFillerWords: () => <div data-testid="top-filler-words" /> }));
vi.mock('../analytics/FillerWordTable', () => ({ FillerWordTable: () => <div data-testid="filler-word-table" /> }));
vi.mock('../analytics/TrendChart', () => ({ TrendChart: () => <div data-testid="trend-chart" /> }));

// Mock Recharts to avoid canvas/resize observer issues in JSDOM
vi.mock('recharts', () => ({
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    LineChart: () => <div data-testid="line-chart" />,
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
}));

// Mock Sonner toast
vi.mock('sonner', () => ({
    toast: {
        error: vi.fn(),
    },
}));

// Define strict Mock Data matching Interfaces
const mockProfile: UserProfile = {
    id: 'test-user',
    email: 'test@example.com',
    subscription_status: 'free',
    created_at: '2023-01-01',
    usage_seconds: 0,
    usage_reset_date: '2023-01-01',
    // Optional fields omitted as per interface
};

// Matches local OverallStats type in AnalyticsDashboard.tsx
const mockStats = {
    totalSessions: 10,
    avgWpm: 120,
    avgFillerWordsPerMin: 5,
    totalPracticeTime: 300,
    avgAccuracy: 85,
    chartData: [
        { date: '2023-01-01', 'FW/min': 5 },
        { date: '2023-01-02', 'FW/min': 4 },
    ],
};

const mockSessionHistory = [
    {
        id: 'session-1',
        created_at: '2023-01-01T10:00:00Z',
        duration: 600,
        total_words: 1200,
        filler_words: { um: { count: 5 } },
        accuracy: 0.9,
    },
];

describe('AnalyticsDashboard', () => {
    const defaultProps = {
        profile: mockProfile,
        sessionHistory: [],
        overallStats: mockStats,
        fillerWordTrends: {},
        loading: false,
        error: null,
        onUpgrade: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const renderComponent = (propsOverride = {}) => {
        const props = { ...defaultProps, ...propsOverride };
        return render(
            <BrowserRouter>
                <AnalyticsDashboard {...props} />
            </BrowserRouter>
        );
    };

    it('should render loading skeleton when loading', () => {
        renderComponent({ loading: true });
        expect(screen.getByTestId('analytics-dashboard-skeleton')).toBeInTheDocument();
    });

    it('should render error display when error occurs', () => {
        renderComponent({ error: new Error('Test error') });
        expect(screen.getByText(/Test error/i)).toBeInTheDocument();
    });

    it('should render empty state when no sessions', () => {
        renderComponent({ sessionHistory: [] });
        expect(screen.getByTestId('analytics-dashboard-empty-state')).toBeInTheDocument();
    });

    it('should render dashboard content when data exists', () => {
        renderComponent({ sessionHistory: mockSessionHistory });

        expect(screen.getByTestId('analytics-dashboard')).toBeInTheDocument();
        expect(screen.getByTestId('stat-card-total_sessions')).toBeInTheDocument();

        // Verify session list is rendered
        const sessionItems = screen.getAllByTestId(/session-history-item-/);
        expect(sessionItems.length).toBeGreaterThan(0);
    });
});
