import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnalyticsDashboard } from '../AnalyticsDashboard';
import { useAnalytics } from '@/hooks/useAnalytics';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';

// Mock dependencies
vi.mock('@/hooks/useAnalytics');
vi.mock('@/lib/supabaseClient');
vi.mock('../../lib/pdfGenerator', () => ({
    generateSessionPdf: vi.fn(),
}));

// Mock sub-components to avoid rendering complex children
vi.mock('../analytics/AccuracyComparison', () => ({ AccuracyComparison: () => <div data-testid="accuracy-comparison" /> }));
vi.mock('../analytics/WeeklyActivityChart', () => ({ WeeklyActivityChart: () => <div data-testid="weekly-activity-chart" /> }));
vi.mock('../analytics/GoalsSection', () => ({ GoalsSection: () => <div data-testid="goals-section" /> }));
vi.mock('../analytics/TopFillerWords', () => ({ TopFillerWords: () => <div data-testid="top-filler-words" /> }));
vi.mock('../analytics/FillerWordTable', () => ({ FillerWordTable: () => <div data-testid="filler-word-table" /> }));

// Mock Recharts to avoid canvas issues
vi.mock('recharts', () => ({
    ResponsiveContainer: ({ children }: { children: any }) => <div>{children}</div>,
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

const mockProfile = {
    id: 'test-user',
    email: 'test@example.com',
    subscription_status: 'free',
    created_at: '2023-01-01',
};

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
    beforeEach(() => {
        vi.clearAllMocks();
        (useAnalytics as any).mockReturnValue({
            sessionHistory: [],
            overallStats: mockStats,
            fillerWordTrends: [],
            loading: false,
            error: null,
        });
    });

    const renderComponent = (profile = mockProfile) => {
        return render(
            <BrowserRouter>
                <AnalyticsDashboard profile={profile as any} />
            </BrowserRouter>
        );
    };

    it('should render loading skeleton when loading', () => {
        (useAnalytics as any).mockReturnValue({ loading: true });
        renderComponent();
        expect(screen.getByTestId('analytics-dashboard-skeleton')).toBeInTheDocument();
    });

    it('should render error display when error occurs', () => {
        (useAnalytics as any).mockReturnValue({ error: new Error('Test error'), loading: false });
        renderComponent();
        expect(screen.getByText(/Test error/i)).toBeInTheDocument();
    });

    it('should render empty state when no sessions', () => {
        (useAnalytics as any).mockReturnValue({
            sessionHistory: [],
            loading: false,
            error: null,
        });
        renderComponent();
        expect(screen.getByTestId('analytics-dashboard-empty-state')).toBeInTheDocument();
    });

    it('should render dashboard content when data exists', () => {
        (useAnalytics as any).mockReturnValue({
            sessionHistory: mockSessionHistory,
            overallStats: mockStats,
            fillerWordTrends: [],
            loading: false,
            error: null,
        });

        renderComponent();

        expect(screen.getByTestId('analytics-dashboard')).toBeInTheDocument();
        expect(screen.getByTestId('stat-card-total-sessions')).toHaveTextContent('10');
        expect(screen.getByTestId('accuracy-comparison')).toBeInTheDocument();
        expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    });

    it('should show upgrade banner for free users', () => {
        (useAnalytics as any).mockReturnValue({
            sessionHistory: mockSessionHistory,
            overallStats: mockStats,
            loading: false,
        });

        renderComponent({ ...mockProfile, subscription_status: 'free' });

        expect(screen.getByTestId('analytics-dashboard-upgrade-button')).toBeInTheDocument();
    });

    it('should NOT show upgrade banner for pro users', () => {
        (useAnalytics as any).mockReturnValue({
            sessionHistory: mockSessionHistory,
            overallStats: mockStats,
            loading: false,
        });

        renderComponent({ ...mockProfile, subscription_status: 'pro' });

        expect(screen.queryByTestId('analytics-dashboard-upgrade-button')).not.toBeInTheDocument();
    });

    it('should handle upgrade button click', async () => {
        (useAnalytics as any).mockReturnValue({
            sessionHistory: mockSessionHistory,
            overallStats: mockStats,
            loading: false,
        });

        const mockInvoke = vi.fn().mockResolvedValue({ data: { checkoutUrl: 'https://stripe.com/checkout' }, error: null });
        (getSupabaseClient as any).mockReturnValue({
            functions: { invoke: mockInvoke },
        });

        // Mock window.location
        const originalLocation = window.location;
        delete (window as any).location;
        (window as any).location = { href: '' };

        renderComponent();

        fireEvent.click(screen.getByTestId('analytics-dashboard-upgrade-button'));

        await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('stripe-checkout'));
        expect(window.location.href).toBe('https://stripe.com/checkout');

        // Cleanup
        (window as any).location = originalLocation;
    });
});
