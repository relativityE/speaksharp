import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { useAnalytics } from '../useAnalytics';
import { usePracticeHistory } from '../usePracticeHistory';
import { useSession } from '../useSession';
import { useParams } from 'react-router-dom';

// Mock dependencies
vi.mock('../usePracticeHistory');
vi.mock('../useSession');
vi.mock('react-router-dom', () => ({
    useParams: vi.fn(),
}));

describe('useAnalytics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useParams as Mock).mockReturnValue({});
        (useSession as Mock).mockReturnValue({ data: null, isLoading: false });
    });

    it('should process analytics data correctly from usePracticeHistory', async () => {
        const mockSessions = [
            {
                id: 's1',
                created_at: '2023-10-27T10:00:00.000Z',
                duration: 60,
                total_words: 100,
                accuracy: 0.9,
                filler_words: { um: { count: 5 }, uh: { count: 3 }, total: { count: 8 } },
                transcript: 'um uh hello world',
                ground_truth: 'hello world',
                engine: 'Cloud AI',
            },
            {
                id: 's2',
                created_at: '2023-10-26T10:00:00.000Z',
                duration: 120,
                total_words: 200,
                accuracy: 0.8,
                filler_words: { um: { count: 10 }, like: { count: 5 }, total: { count: 15 } },
                transcript: 'um like hi there',
                ground_truth: 'hi there',
                engine: 'Private',
            },
        ];

        (usePracticeHistory as Mock).mockReturnValue({
            data: mockSessions,
            isLoading: false,
            error: null
        });

        const { result } = renderHook(() => useAnalytics());

        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBe(null);
        expect(result.current.sessionHistory).toEqual(mockSessions);

        // Check derived stats
        expect(result.current.topFillerWords).toEqual([
            { word: 'um', count: 15 },
            { word: 'like', count: 5 },
        ]);

        expect(result.current.overallStats.totalSessions).toBe(2);
        expect(result.current.overallStats.totalPracticeTime).toBe(3); // 180s / 60 = 3m
    });

    it('should filter sessions when sessionId is present in URL', async () => {
        const mockSessions = [
            { id: 's1', duration: 60, filler_words: {} },
            { id: 's2', duration: 120, filler_words: {} }
        ];

        (usePracticeHistory as Mock).mockReturnValue({
            data: mockSessions,
            isLoading: false,
            error: null
        });

        (useParams as Mock).mockReturnValue({ sessionId: 's1' });

        const { result } = renderHook(() => useAnalytics());

        expect(result.current.sessionHistory).toHaveLength(1);
        expect(result.current.sessionHistory[0].id).toBe('s1');
        expect(result.current.overallStats.totalSessions).toBe(1);
    });
});