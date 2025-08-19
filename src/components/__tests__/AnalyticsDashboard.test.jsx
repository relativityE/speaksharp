import { describe, it, expect } from 'vitest';
import { calculateTrends } from '../AnalyticsDashboard';

describe('calculateTrends', () => {
    it('should return zeroed-out data for empty or null history', () => {
        expect(calculateTrends([])).toEqual({
            avgFillerWordsPerMin: "0.0",
            totalSessions: 0,
            totalPracticeTime: 0,
            chartData: [],
            topFillerWords: [],
        });
        expect(calculateTrends(null)).toEqual({
            avgFillerWordsPerMin: "0.0",
            totalSessions: 0,
            totalPracticeTime: 0,
            chartData: [],
            topFillerWords: [],
        });
    });

    it('should correctly calculate trends for a single valid session', () => {
        const history = [{
            id: 1,
            created_at: new Date().toISOString(),
            duration: 120, // 2 minutes
            filler_words: { 'um': { count: 5 }, 'like': { count: 5 } },
        }];
        const trends = calculateTrends(history);
        expect(trends.totalSessions).toBe(1);
        expect(trends.totalPracticeTime).toBe(2); // 2 minutes
        expect(trends.avgFillerWordsPerMin).toBe("5.0"); // 10 fillers / 2 mins
        expect(trends.topFillerWords).toEqual([
            { name: 'um', value: 5 },
            { name: 'like', value: 5 },
        ]);
    });

    it('should handle non-numeric or missing duration to prevent NaN errors', () => {
        const history = [{
            id: 1,
            created_at: new Date().toISOString(),
            duration: 'not-a-number',
            filler_words: { 'so': { count: 10 } },
        }, {
            id: 2,
            created_at: new Date().toISOString(),
            duration: null,
            filler_words: { 'so': { count: 5 } },
        }, {
            id: 3,
            created_at: new Date().toISOString(),
            duration: 60, // 1 minute
            filler_words: { 'so': { count: 15 } },
        }];
        const trends = calculateTrends(history);
        expect(trends.totalSessions).toBe(3);
        expect(trends.totalPracticeTime).toBe(1); // Only the valid 1 minute session
        // Total fillers from valid sessions = 15. Total time = 1 min.
        expect(trends.avgFillerWordsPerMin).toBe("15.0");
    });

    it('should handle the new "filler_words" object schema', () => {
        const history = [{
            id: 1,
            created_at: new Date().toISOString(),
            duration: 60,
            filler_words: { 'uh': { count: 3 }, 'so': { count: 7 } },
        }];
        const trends = calculateTrends(history);
        expect(trends.avgFillerWordsPerMin).toBe("10.0");
        expect(trends.topFillerWords).toContainEqual({ name: 'so', value: 7 });
        expect(trends.topFillerWords).toContainEqual({ name: 'uh', value: 3 });
    });

    it('should correctly aggregate data from multiple sessions', () => {
        const history = [{
            id: 1,
            duration: 60,
            created_at: new Date().toISOString(),
            filler_words: { 'like': { count: 5 } },
        }, {
            id: 2,
            duration: 60,
            created_at: new Date().toISOString(),
            filler_words: { 'like': { count: 5 }, 'so': { count: 10 } },
        }, {
            id: 3,
            duration: 60,
            created_at: new Date().toISOString(),
            filler_words: { 'so': { count: 10 }, 'um': { count: 20 } },
        }];
        const trends = calculateTrends(history);
        // total duration = 3 mins. total fillers = 5 + (5+10) + (10+20) = 50
        expect(trends.totalPracticeTime).toBe(3);
        // total fillers = 5 + 15 + 30 = 50. 50/3 = 16.666...
        expect(trends.avgFillerWordsPerMin).toBe("16.7");
        expect(trends.topFillerWords).toEqual([
            { name: 'um', value: 20 },
            { name: 'so', value: 20 },
            { name: 'like', value: 10 },
        ]);
    });

    it('should generate correct chart data', () => {
        const history = [{
            id: 1,
            created_at: '2025-08-11T10:00:00Z',
            duration: 60, // 1 min
            filler_words: { 'um': { count: 6 } },
        }, {
            id: 2,
            created_at: '2025-08-12T10:00:00Z',
            duration: 120, // 2 mins
            filler_words: { 'um': { count: 6 } },
        }];
        const trends = calculateTrends(history);
        const expectedDate1 = new Date('2025-08-11T10:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const expectedDate2 = new Date('2025-08-12T10:00:00Z').toLocaleDateString('en-us', { month: 'short', day: 'numeric' });

        // Note: history is reversed in chartData
        expect(trends.chartData).toEqual([
            { date: expectedDate2, 'FW/min': "3.0" }, // 6 fillers / 2 mins
            { date: expectedDate1, 'FW/min': "6.0" }, // 6 fillers / 1 min
        ]);
    });
});
