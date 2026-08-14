import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '../../../../tests/support/test-utils';
import { STTAccuracyVsBenchmark } from '../STTAccuracyVsBenchmark';
import * as AnalyticsHook from '@/hooks/useAnalytics';
import * as RouterDom from 'react-router-dom';

vi.mock('@/hooks/useAnalytics');
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual as Record<string, unknown>,
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
                averageSessionLength: 0,
                averageWPM: 0,
                avgFillerWordsPerMin: "0.0",
                avgClarity: "0.0",
                chartData: []
            },
            fillerWordTrends: {},
            topFillerWords: [],
            weeklySessionsCount: 0,
            weeklyActivity: [],
            refreshAnalytics: vi.fn(),
        } as unknown as ReturnType<typeof AnalyticsHook.useAnalytics>);

        render(<STTAccuracyVsBenchmark />);
        expect(screen.getByText('Transcription quality')).toBeInTheDocument();
    });

    it('should render engine quality fallback when no WER benchmark data exists', () => {
        mockUseAnalytics.mockReturnValue({
            accuracyData: [],
            sessionHistory: [
                {
                    id: 'native-session',
                    user_id: 'user',
                    created_at: new Date().toISOString(),
                    duration: 60,
                    transcript: 'hello world',
                    engine: 'native',
                    clarity_score: 91,
                    filler_words: { total: { count: 2 }, um: { count: 2 } },
                },
                {
                    id: 'cloud-session',
                    user_id: 'user',
                    created_at: new Date().toISOString(),
                    duration: 120,
                    transcript: 'hello cloud',
                    engine: 'cloud',
                    clarity_score: 84,
                    filler_words: { total: { count: 8 }, uh: { count: 8 } },
                },
            ],
            loading: false,
            error: null,
            overallStats: {
                totalSessions: 0,
                totalPracticeTime: 0,
                averageSessionLength: 0,
                averageWPM: 0,
                avgFillerWordsPerMin: "0.0",
                avgClarity: "0.0",
                chartData: []
            },
            fillerWordTrends: {
                'uh': { current: 1.2, previous: 0.8 },
                'um': { current: 0.5, previous: 0.7 }
            },
            topFillerWords: [],
            weeklySessionsCount: 0,
            weeklyActivity: [],
            refreshAnalytics: vi.fn(),
        } as unknown as ReturnType<typeof AnalyticsHook.useAnalytics>);

        render(<STTAccuracyVsBenchmark />);
        expect(screen.getByText('Transcription quality')).toBeInTheDocument();
        expect(screen.getByText(/Based on saved session metrics/)).toBeInTheDocument();
        expect(screen.getAllByText(/Legacy recording/).length).toBeGreaterThan(0);
        for (const retired of ['Browser', 'Cloud', 'Native', 'assemblyai', 'whisper-base', 'transformers-js-v4']) {
            expect(screen.queryByText(new RegExp(retired, 'i'))).not.toBeInTheDocument();
        }
        expect(screen.queryByText('Theoretical Max')).not.toBeInTheDocument();
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
                averageSessionLength: 0,
                averageWPM: 0,
                avgFillerWordsPerMin: "0.0",
                avgClarity: "0.0",
                chartData: []
            },
            fillerWordTrends: {},
            topFillerWords: [],
            weeklySessionsCount: 0,
            weeklyActivity: [],
            refreshAnalytics: vi.fn(),
        } as unknown as ReturnType<typeof AnalyticsHook.useAnalytics>);

        render(<STTAccuracyVsBenchmark />);
        expect(screen.getByText('Complete a session to see transcription quality.')).toBeInTheDocument();
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
                averageSessionLength: 0,
                averageWPM: 0,
                avgFillerWordsPerMin: "0.0",
                avgClarity: "0.0",
                chartData: []
            },
            fillerWordTrends: {},
            topFillerWords: [],
            weeklySessionsCount: 0,
            weeklyActivity: [],
            refreshAnalytics: vi.fn(),
        } as unknown as ReturnType<typeof AnalyticsHook.useAnalytics>);

        render(<STTAccuracyVsBenchmark />);
        expect(screen.getByText('Session transcription accuracy')).toBeInTheDocument();
        expect(screen.getByText(/Internal provider and implementation labels/)).toBeInTheDocument();
        expect(screen.queryByText(/Theoretical Max/)).not.toBeInTheDocument();
    });

    it('neutralizes every historical engine/provider/variant in customer-visible output', () => {
        mockUseAnalytics.mockReturnValue({
            accuracyData: [],
            sessionHistory: ['native', 'cloud', 'assemblyai', 'browser', 'transformers-js-v4'].map((engine, index) => ({
                id: `legacy-${index}`,
                user_id: 'user',
                created_at: new Date().toISOString(),
                duration: 60,
                transcript: 'historical transcript',
                engine,
                clarity_score: 80,
                filler_words: {},
            })),
            loading: false,
            error: null,
            overallStats: {},
            fillerWordTrends: {},
            topFillerWords: [],
            weeklySessionsCount: 0,
            weeklyActivity: [],
            refreshAnalytics: vi.fn(),
        } as unknown as ReturnType<typeof AnalyticsHook.useAnalytics>);

        const { container } = render(<STTAccuracyVsBenchmark />);
        expect(container).toHaveTextContent('Legacy recording');
        for (const retired of ['native', 'cloud', 'assemblyai', 'browser', 'transformers-js-v4']) {
            expect(container.textContent?.toLowerCase()).not.toContain(retired);
        }
    });
});
