import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '../../../../tests/support/test-utils';
import { STTAccuracyVsBenchmark } from '../STTAccuracyVsBenchmark';
import * as AnalyticsHook from '@/hooks/useAnalytics';
import * as RouterDom from 'react-router-dom';
import type { PracticeSession } from '@/types/session';

vi.mock('@/hooks/useAnalytics');
vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-router-dom')>();
    return {
        ...actual,
        useParams: vi.fn(),
    };
});

describe('STTAccuracyVsBenchmark', () => {
    const mockUseAnalytics = vi.mocked(AnalyticsHook.useAnalytics);
    const mockUseParams = vi.mocked(RouterDom.useParams);

    const mockStats = {
        totalSessions: 0,
        totalPracticeTime: 0,
        avgWpm: 0,
        avgFillerWordsPerMin: "0.0",
        avgAccuracy: "0.0",
        chartData: []
    };

    const mockBaseReturn = {
        accuracyData: [],
        sessionHistory: [],
        loading: false,
        error: null,
        overallStats: mockStats,
        fillerWordTrends: {},
        topFillerWords: [],
        weeklySessionsCount: 0,
        weeklyActivity: [],
        refreshAnalytics: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockUseParams.mockReturnValue({});
    });

    it('should render loading skeleton', () => {
        mockUseAnalytics.mockReturnValue({
            ...mockBaseReturn,
            loading: true,
        });

        render(<STTAccuracyVsBenchmark />);
        expect(screen.getByText('STT Accuracy vs Benchmark')).toBeInTheDocument();
    });

    it('should render dashboard trend view when no session id is provided', () => {
        mockUseAnalytics.mockReturnValue({
            ...mockBaseReturn,
            accuracyData: [
                { date: '10/10', accuracy: 85, engine: 'Native' },
                { date: '10/11', accuracy: 92, engine: 'Private' },
            ],
        });

        render(<STTAccuracyVsBenchmark />);
        expect(screen.getByText('Dynamic STT Accuracy vs Ceiling')).toBeInTheDocument();
    });

    it('should render empty state when no ground truth data exists', () => {
        mockUseAnalytics.mockReturnValue(mockBaseReturn);

        render(<STTAccuracyVsBenchmark />);
        expect(screen.getByText('Provide ground truth transcripts to see your accuracy benchmarked against STT ceilings.')).toBeInTheDocument();
    });

    it('should render specific session view when URL has sessionId parameter', () => {
        mockUseParams.mockReturnValue({ sessionId: 'session-123' });

        mockUseAnalytics.mockReturnValue({
            ...mockBaseReturn,
            accuracyData: [
                { date: '10/10', accuracy: 88, engine: 'Private' }
            ],
            sessionHistory: [
                {
                    id: 'session-123',
                    user_id: 'user',
                    created_at: new Date().toISOString(),
                    duration: 60,
                    transcript: 'Hello world',
                    ground_truth: 'Hello world',
                    engine: 'Private',
                } as PracticeSession
            ],
        });

        render(<STTAccuracyVsBenchmark />);
        expect(screen.getByText(/Session Accuracy vs/)).toBeInTheDocument();
        expect(screen.getByText(/Private/)).toBeInTheDocument();
        expect(screen.getByText(/This session used the/)).toBeInTheDocument();
    });
});
