import { describe, it, expect } from 'vitest';
import { calculateFillerWordTrends } from '../analyticsUtils';

const mockSessions = [
    // Session 1 (most recent)
    {
        created_at: '2023-01-03T10:00:00Z',
        filler_words: {
            'um': { count: 3 },
            'like': { count: 1 },
        },
    },
    // Session 2
    {
        created_at: '2023-01-02T10:00:00Z',
        filler_words: {
            'um': { count: 6 },
            'so': { count: 2 },
        },
    },
    // Session 3 (oldest)
    {
        created_at: '2023-01-01T10:00:00Z',
        filler_words: {
            'like': { count: 4 },
            'so': { count: 0 },
        },
    },
];

describe('calculateFillerWordTrends', () => {
    it('should return an empty object for no sessions', () => {
        expect(calculateFillerWordTrends([])).toEqual({});
    });

    it('should calculate trends correctly for multiple sessions', () => {
        const trends = calculateFillerWordTrends(mockSessions);

        // Test for 'um'
        expect(trends.um).toBeDefined();
        expect(trends.um.length).toBe(3);
        expect(trends.um[0]).toEqual({
            count: 3,
            severity: 'green',
            tooltip: '50% decrease from last session (6 to 3)',
        });
        expect(trends.um[1]).toEqual({
            count: 6,
            severity: 'yellow',
            tooltip: '100% increase from last session (0 to 6)',
        });
        expect(trends.um[2]).toEqual({
            count: 0,
            severity: 'green',
            tooltip: 'Count: 0',
        });

        // Test for 'like'
        expect(trends.like).toBeDefined();
        expect(trends.like[0].count).toBe(1);
        expect(trends.like[1].count).toBe(0);
        expect(trends.like[2].count).toBe(4);
        expect(trends.like[0].tooltip).toContain('100% increase'); // 0 to 1

        // Test for 'so'
        expect(trends.so).toBeDefined();
        expect(trends.so[1].count).toBe(2);
        expect(trends.so[2].count).toBe(0);
        expect(trends.so[1].tooltip).toContain('100% increase'); // 0 to 2
    });

    it('should handle sessions with no filler words gracefully', () => {
        const sessions = [{ created_at: '2023-01-01T10:00:00Z', filler_words: {} }];
        const trends = calculateFillerWordTrends(sessions);
        for (const word in trends) {
            expect(trends[word][0].count).toBe(0);
        }
    });
});
