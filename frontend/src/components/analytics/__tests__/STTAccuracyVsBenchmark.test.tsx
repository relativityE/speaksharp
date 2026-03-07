import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '../../../../tests/support/test-utils';
import { STTAccuracyVsBenchmark } from '../STTAccuracyVsBenchmark';
import * as AnalyticsHook from '@/hooks/useAnalytics';
import * as RouterDom from 'react-router-dom';

vi.mock('@/hooks/useAnalytics');
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual as any,
        useParams: vi.fn(),
    };
});

describe('STTAccuracyVsBenchmark', () => {
    const mockUseAnalytics = vi.mocked(AnalyticsHook.useAnalytics);
    const mockUseParams = vi.mocked(RouterDom.useParams);

    beforeEach(() => {
        vi.clearAllMocks();
        mockUseParams.mockReturnValue({});
    });

    it('should render loading skeleton', () => {
        mockUseAnalytics.mockReturnValue({
            accuracyData: [],
            sessionHistory: [],
            loading: true,
            error: null,
            overallStats: {
                totalSessions: 0,
                totalPracticeTime: 0,
                averageWPM: 0,
                averageClarity: 0,
                totalWords: 0,
                averageAccuracy: 0,
            },
            fillerWordTrends: { dates: [], datasets: [] },
            topFillerWords: [],
            weeklySessionsCount: 0,
            weeklyActivity: [],
            refreshAnalytics: vi.fn(),
        });

        render(<STTAccuracyVsBenchmark />);
        expect(screen.getByText('STT Accuracy vs Benchmark')).toBeInTheDocument();
    });

    it('should render dashboard trend view when no session id is provided', () => {
        mockUseAnalytics.mockReturnValue({
            accuracyData: [
                { date: '10/10', accuracy: 85, engine: 'Native' },
                { date: '10/11', accuracy: 92, engine: 'Private' },
            ],
            sessionHistory: [],
            loading: false,
            error: null,
            overallStats: {
                totalSessions: 0,
                totalPracticeTime: 0,
                averageWPM: 0,
                averageClarity: 0,
                totalWords: 0,
                averageAccuracy: 0,
            },
            fillerWordTrends: { dates: [], datasets: [] },
            topFillerWords: [],
            weeklySessionsCount: 0,
            weeklyActivity: [],
            refreshAnalytics: vi.fn(),
        });

        render(<STTAccuracyVsBenchmark />);
        expect(screen.getByText('Dynamic STT Accuracy vs Ceiling')).toBeInTheDocument();
    });

    it('should render empty state when no ground truth data exists', () => {
        mockUseAnalytics.mockReturnValue({
            accuracyData: [],
            sessionHistory: [],
            loading: false,
            error: null,
            overallStats: {
                totalSessions: 0,
                totalPracticeTime: 0,
                averageWPM: 0,
                averageClarity: 0,
                totalWords: 0,
                averageAccuracy: 0,
            },
            fillerWordTrends: { dates: [], datasets: [] },
            topFillerWords: [],
            weeklySessionsCount: 0,
            weeklyActivity: [],
            refreshAnalytics: vi.fn(),
        });

        render(<STTAccuracyVsBenchmark />);
        expect(screen.getByText('Provide ground truth transcripts to see your accuracy benchmarked against STT ceilings.')).toBeInTheDocument();
    });

    it('should render specific session view when URL has sessionId parameter', () => {
        mockUseParams.mockReturnValue({ sessionId: 'session-123' });

        mockUseAnalytics.mockReturnValue({
            accuracyData: [
                { date: '10/10', accuracy: 88, engine: 'Private' } // Mocked filtered accuracy data
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
                }
            ],
            loading: false,
            error: null,
            overallStats: {
                totalSessions: 0,
                totalPracticeTime: 0,
                averageWPM: 0,
                averageClarity: 0,
                totalWords: 0,
                averageAccuracy: 0,
            },
            fillerWordTrends: { dates: [], datasets: [] },
            topFillerWords: [],
            weeklySessionsCount: 0,
            weeklyActivity: [],
            refreshAnalytics: vi.fn(),
        });

        render(<STTAccuracyVsBenchmark />);
        expect(screen.getByText(/Session Accuracy vs/)).toBeInTheDocument();
        expect(screen.getByText(/Private/)).toBeInTheDocument();
        expect(screen.getByText(/This session used the/)).toBeInTheDocument();
    });
});
