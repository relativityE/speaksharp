import { describe, it, expect } from 'vitest';
import { calculateOverallStats, calculateFillerWordTrends, calculateAccuracyData, calculateTopFillerWords, getSessionPauseCount } from '../analyticsUtils';
import { PracticeSession } from '@/types/session';

const mockSessionHistory: PracticeSession[] = [
    {
        id: '1',
        created_at: '2023-10-27T10:00:00.000Z',
        user_id: 'user-1',
        duration: 300,
        total_words: 500,
        filler_words: { um: { count: 5 }, uh: { count: 3 }, total: { count: 8 } },
        accuracy: 0.95,
        clarity_score: 95,
        title: 'Session 1',
        transcript: '... um ... uh ...',
        pause_metrics: { silencePercentage: 10, transitionPauses: 8, extendedPauses: 2, longestPause: 2 },
    },
    {
        id: '2',
        created_at: '2023-10-26T10:00:00.000Z',
        user_id: 'user-1',
        duration: 600,
        total_words: 1000,
        filler_words: { um: { count: 10 }, like: { count: 5 }, total: { count: 15 } },
        accuracy: 0.90,
        clarity_score: 90,
        title: 'Session 2',
        transcript: '... um ... like ...',
        pause_metrics: { silencePercentage: 12, transitionPauses: 15, extendedPauses: 5, longestPause: 3 },
    },
];

describe('analyticsUtils', () => {
    describe('calculateOverallStats', () => {
        it('should calculate overall stats correctly', () => {
            const stats = calculateOverallStats(mockSessionHistory);
            expect(stats.totalSessions).toBe(2);
            expect(stats.totalPracticeTime).toBe(15);
            expect(stats.averageWPM).toBe(100);
            expect(stats.avgFillerWordsPerMin).toBe('1.5');
            expect(stats.avgClarity).toBe('92.5');
            // Pause Rhythm: (8+2) + (15+5) = 30 pauses over 15 speaking minutes = 2.0/min.
            expect(stats.avgPausesPerMin).toBe('2.0');
        });

        it('aggregates Pause Rhythm (pauses/min) from short + long pauses, and is 0 without pause data', () => {
            // getSessionPauseCount = transitionPauses + extendedPauses.
            expect(getSessionPauseCount(mockSessionHistory[0])).toBe(10);
            expect(getSessionPauseCount(mockSessionHistory[1])).toBe(20);
            // A session with no pause_metrics contributes 0 (no crash, no NaN).
            expect(getSessionPauseCount({ id: 'x' } as PracticeSession)).toBe(0);
            expect(calculateOverallStats([
                { id: 'no-pauses', created_at: '2026-01-01T00:00:00.000Z', user_id: 'u', duration: 60, total_words: 60, filler_words: {}, transcript: 'word '.repeat(60) },
            ] as PracticeSession[]).avgPausesPerMin).toBe('0.0');
        });

        it('aggregates Clear Delivery (clarity) from clarity_score and ignores the unrelated STT accuracy field', () => {
            // Regression for the aggregate-Clarity-0% bug: a session can have accuracy=0 (or absent)
            // while clarity_score is high. The aggregate must reflect clarity_score, not STT accuracy.
            const stats = calculateOverallStats([
                {
                    id: 'mismatch',
                    created_at: '2026-01-01T00:00:00.000Z',
                    user_id: 'user-1',
                    duration: 120,
                    total_words: 200,
                    transcript: Array.from({ length: 200 }, (_, i) => `word${i}`).join(' '),
                    filler_words: {},
                    accuracy: 0,
                    clarity_score: 85,
                    title: 'Accuracy 0, Clarity 85',
                },
            ] as PracticeSession[]);

            expect(stats.avgClarity).toBe('85.0');
        });

        it('uses aggregate words over aggregate time so short sessions do not distort average WPM', () => {
            const stats = calculateOverallStats([
                {
                    id: 'short-fast',
                    created_at: '2026-05-24T12:00:00.000Z',
                    user_id: 'user-1',
                    duration: 10,
                    total_words: 40,
                    transcript: Array.from({ length: 40 }, (_, index) => `word${index}`).join(' '),
                    filler_words: {},
                    title: 'Short fast session',
                },
                {
                    id: 'long-normal',
                    created_at: '2026-05-24T12:10:00.000Z',
                    user_id: 'user-1',
                    duration: 110,
                    total_words: 110,
                    transcript: Array.from({ length: 110 }, (_, index) => `word${index}`).join(' '),
                    filler_words: {},
                    title: 'Long normal session',
                },
            ] as PracticeSession[]);

            expect(stats.averageWPM).toBe(75);
        });
    });

    describe('calculateFillerWordTrends', () => {
        it('normalizes filler word trends by speaking time', () => {
            const trends = calculateFillerWordTrends(mockSessionHistory);
            expect(trends.um.current).toBe(1); // 15 ums / 15 speaking minutes
            expect(trends.um.previous).toBe(0);
            expect(trends.uh.current).toBe(0.2); // 3 uhs / 15 speaking minutes
            expect(trends.uh.previous).toBe(0);
            expect(trends.like.current).toBe(0.33); // 5 likes / 15 speaking minutes
            expect(trends.like.previous).toBe(0);
        });
    });

    describe('calculateAccuracyData', () => {
        it('should return accuracy as rounded percentage', () => {
            const history: PracticeSession[] = [{
                id: '3',
                user_id: 'user-1',
                created_at: '2023-10-25T10:00:00.000Z',
                ground_truth: 'hello world',
                transcript: 'hello word', // 1 substitution, 2 words total. WER = 0.5. Accuracy = 50%
                engine: 'Private',
                duration: 10,
                total_words: 2,
                filler_words: {}
            } as unknown as PracticeSession];

            const result = calculateAccuracyData(history);
            expect(result).toHaveLength(1);
            expect(result[0].accuracy).toBe(50);
        });

        it('should handle fractional accuracy correctly with rounding', () => {
            const history: PracticeSession[] = [{
                id: '4',
                user_id: 'user-1',
                created_at: '2023-10-24T10:00:00.000Z',
                ground_truth: 'the quick brown fox',
                transcript: 'the quick brown fix', // 1 sub, 4 words. WER = 0.25. Accuracy = 75%
                engine: 'Cloud AI',
                duration: 10,
                total_words: 4,
                filler_words: {}
            } as unknown as PracticeSession];

            const result = calculateAccuracyData(history);
            expect(result[0].accuracy).toBe(75);
        });
    });

    describe('calculateTopFillerWords', () => {
        it('correctly aggregates filler words and returns sorted results', () => {
            const sessionHistory = [
                {
                    filler_words: {
                        um: { count: 10 },
                        like: { count: 5 },
                        total: { count: 15 }
                    }
                },
                {
                    filler_words: {
                        um: { count: 5 },
                        basically: { count: 20 },
                        total: { count: 25 }
                    }
                }
            ] as Partial<PracticeSession>[] as PracticeSession[];

            const result = calculateTopFillerWords(sessionHistory);

            expect(result).toEqual([
                { word: 'basically', count: 20 },
                { word: 'um', count: 15 },
                { word: 'like', count: 5 }
            ]);
        });

        it('ignores "total" keyword', () => {
            const sessionHistory = [
                {
                    filler_words: {
                        total: { count: 100 }
                    }
                }
            ] as Partial<PracticeSession>[] as PracticeSession[];

            const result = calculateTopFillerWords(sessionHistory);
            expect(result.find(r => r.word === 'total')).toBeUndefined();
        });

        it('handles empty session history', () => {
            const result = calculateTopFillerWords([]);
            expect(result).toEqual([]);
        });

        it('handles sessions with no filler words', () => {
            const sessionHistory = [
                { id: '1' }
            ] as Partial<PracticeSession>[] as PracticeSession[];
            const result = calculateTopFillerWords(sessionHistory);
            expect(result).toEqual([]);
        });
    });
});
