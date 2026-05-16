import { fireEvent, render, screen } from '../../../tests/support/test-utils';
import { AnalyticsDashboard } from '../AnalyticsDashboard';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import type { UserProfile } from '@/types/user';

// Mock dependencies
vi.mock('../../lib/pdfGenerator', () => ({
    generateSessionPdf: vi.fn(),
}));

// Mock sub-components explicitly to ensure isolation
vi.mock('../analytics/STTAccuracyVsBenchmark', () => ({ STTAccuracyVsBenchmark: () => <div data-testid="accuracy-comparison" /> }));
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
    averageWPM: 120,
    avgFillerWordsPerMin: 5,
    totalPracticeTime: 300,
    avgAccuracy: 85,
    chartData: [
        { date: '2023-01-01', 'FW/min': 5, clarity: 80 },
        { date: '2023-01-02', 'FW/min': 4, clarity: 85 },
    ],
};

const mockSessionHistory = [
    {
        id: 'session-1',
        user_id: 'test-user',
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
        localStorage.clear();
    });

    const renderComponent = (propsOverride = {}) => {
        const props = { ...defaultProps, ...propsOverride };
        return render(<AnalyticsDashboard {...props} />);
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

    it('uses persisted WPM and clarity values for session comparison instead of recalculating legacy fields', () => {
        renderComponent({
            sessionHistory: [
                {
                    id: 'session-1',
                    user_id: 'test-user',
                    created_at: '2023-01-01T10:00:00Z',
                    duration: 60,
                    total_words: 120,
                    wpm: 111,
                    clarity_score: 77,
                    filler_words: { um: { count: 2 } },
                    accuracy: 0.9,
                },
                {
                    id: 'session-2',
                    user_id: 'test-user',
                    created_at: '2023-01-02T10:00:00Z',
                    duration: 60,
                    total_words: 140,
                    wpm: 123,
                    clarity_score: 88,
                    filler_words: { um: { count: 1 } },
                    accuracy: 0.95,
                },
            ],
        });

        screen.getAllByRole('checkbox').forEach((checkbox) => fireEvent.click(checkbox));
        fireEvent.click(screen.getByRole('button', { name: /compare selected/i }));

        expect(screen.getByText('Session Comparison')).toBeInTheDocument();
        expect(screen.getAllByText('111').length).toBeGreaterThan(0);
        expect(screen.getAllByText('123').length).toBeGreaterThan(0);
        expect(screen.getAllByText('77%').length).toBeGreaterThan(0);
        expect(screen.getAllByText('88%').length).toBeGreaterThan(0);
    });

    it('does not double-count synthetic total filler rows in session detail metrics', () => {
        renderComponent({
            sessionId: 'session-1',
            sessionHistory: [
                {
                    id: 'session-1',
                    user_id: 'test-user',
                    created_at: '2023-01-01T10:00:00Z',
                    duration: 60,
                    total_words: 120,
                    wpm: 120,
                    clarity_score: 90,
                    filler_words: {
                        um: { count: 2 },
                        like: { count: 3 },
                        total: { count: 5 },
                    },
                    transcript: 'um like like like words',
                },
            ],
        });

        expect(screen.getByTestId('filler-count-value')).toHaveTextContent('5');
    });

    it('shows saved recording mode metadata in the session detail view', () => {
        renderComponent({
            sessionId: 'session-1',
            sessionHistory: [
                {
                    id: 'session-1',
                    user_id: 'test-user',
                    created_at: '2023-01-01T10:00:00Z',
                    duration: 60,
                    total_words: 120,
                    engine: 'private',
                    engine_version: 'transformers-js-2.17',
                    model_name: 'whisper-tiny.en',
                    device_type: 'cpu',
                    transcript: 'hello world',
                },
            ],
        });

        expect(screen.getByTestId('session-engine-metadata')).toHaveTextContent(
            'Private (whisper-tiny.en, transformers-js-2.17, cpu)'
        );
    });

    it('normalizes native metadata and hides placeholder details in detail view', () => {
        renderComponent({
            sessionId: 'native-session',
            sessionHistory: [
                {
                    id: 'native-session',
                    user_id: 'test-user',
                    created_at: '2023-01-01T10:00:00Z',
                    duration: 60,
                    total_words: 120,
                    engine: 'native',
                    engine_version: 'unknown',
                    model_name: 'unknown',
                    device_type: 'unknown',
                },
            ],
        });

        expect(screen.getByTestId('session-engine-metadata')).toHaveTextContent(
            'Native Browser'
        );
    });

    it('shows PDF export in Basic session detail while keeping script upload Pro-only', () => {
        renderComponent({
            sessionId: 'basic-session',
            profile: { ...mockProfile, subscription_status: 'free' },
            sessionHistory: [
                {
                    id: 'basic-session',
                    user_id: 'test-user',
                    created_at: '2023-01-01T10:00:00Z',
                    duration: 60,
                    total_words: 120,
                    wpm: 120,
                    clarity_score: 90,
                    filler_words: { um: { count: 1 } },
                    transcript: 'hello world',
                },
            ],
        });

        expect(screen.getByRole('button', { name: /export pdf/i })).toBeInTheDocument();
        expect(screen.queryByTestId('upload-ground-truth-btn')).not.toBeInTheDocument();
    });

    it('shows visible STT engine badges on session history cards', () => {
        renderComponent({
            sessionHistory: [
                {
                    id: 'cloud-session',
                    user_id: 'test-user',
                    created_at: '2023-01-01T10:00:00Z',
                    duration: 60,
                    total_words: 120,
                    engine: 'cloud',
                },
                {
                    id: 'private-session',
                    user_id: 'test-user',
                    created_at: '2023-01-02T10:00:00Z',
                    duration: 60,
                    total_words: 120,
                    engine: 'private',
                },
                {
                    id: 'native-session',
                    user_id: 'test-user',
                    created_at: '2023-01-03T10:00:00Z',
                    duration: 60,
                    total_words: 120,
                    engine: 'native',
                },
            ],
        });

        expect(screen.getByTestId('session-engine-badge-cloud-session')).toHaveTextContent('Cloud');
        expect(screen.getByTestId('session-engine-badge-private-session')).toHaveTextContent('Private');
        expect(screen.getByTestId('session-engine-badge-native-session')).toHaveTextContent('Native Browser');
    });
});
