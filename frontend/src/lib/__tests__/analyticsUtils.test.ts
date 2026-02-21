import { describe, it, expect } from 'vitest';
import { calculateOverallStats, calculateFillerWordTrends, calculateAccuracyData } from '../analyticsUtils';
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
        title: 'Session 1',
        transcript: '... um ... uh ...',
    },
    {
        id: '2',
        created_at: '2023-10-26T10:00:00.000Z',
        user_id: 'user-1',
        duration: 600,
        total_words: 1000,
        filler_words: { um: { count: 10 }, like: { count: 5 }, total: { count: 15 } },
        accuracy: 0.90,
        title: 'Session 2',
        transcript: '... um ... like ...',
    },
];

describe('analyticsUtils', () => {
    describe('calculateOverallStats', () => {
        it('should calculate overall stats correctly', () => {
            const stats = calculateOverallStats(mockSessionHistory);
            expect(stats.totalSessions).toBe(2);
            expect(stats.totalPracticeTime).toBe(15);
            expect(stats.avgWpm).toBe(100);
            expect(stats.avgFillerWordsPerMin).toBe('1.5');
            expect(stats.avgAccuracy).toBe('92.5');
        });
    });

    describe('calculateFillerWordTrends', () => {
        it('should calculate filler word trends correctly', () => {
            const trends = calculateFillerWordTrends(mockSessionHistory);
            expect(trends.um.current).toBe(7.5); // Average of (5 + 10) / 2
            expect(trends.um.previous).toBe(0);
            expect(trends.uh.current).toBe(1.5); // Average of (3 + 0) / 2
            expect(trends.uh.previous).toBe(0);
            expect(trends.like.current).toBe(2.5); // Average of (0 + 5) / 2
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
            } as any];

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
            } as any];

            const result = calculateAccuracyData(history);
            expect(result[0].accuracy).toBe(75);
        });
    });
});