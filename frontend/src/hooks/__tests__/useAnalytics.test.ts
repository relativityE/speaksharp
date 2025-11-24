import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useAnalytics } from '../useAnalytics';

const mockQueryBuilder = {
  select: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn(),
};

const mockSupabase = {
  from: vi.fn(() => mockQueryBuilder),
};

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => mockSupabase,
}));

describe('useAnalytics', () => {
    it('should fetch and process analytics data correctly', async () => {
        const mockSessions = [
            {
                created_at: '2023-10-27T10:00:00.000Z',
                filler_words: { um: { count: 5 }, uh: { count: 3 } },
                transcript: 'um uh hello world',
                ground_truth: 'hello world',
                engine: 'Cloud AI',
            },
            {
                created_at: '2023-10-26T10:00:00.000Z',
                filler_words: { um: { count: 10 }, like: { count: 5 } },
                transcript: 'um like hi there',
                ground_truth: 'hi there',
                engine: 'On-Device',
            },
        ];
        mockQueryBuilder.limit.mockResolvedValueOnce({ data: mockSessions, error: null });

        const { result } = renderHook(() => useAnalytics());

        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBe(null);
        expect(result.current.topFillerWords).toEqual([
            { word: 'um', count: 15 },
            { word: 'like', count: 5 },
        ]);
        expect(result.current.accuracyData).toEqual([
            { date: new Date('2023-10-26T10:00:00.000Z').toLocaleDateString(), accuracy: 0, engine: 'On-Device' },
            { date: new Date('2023-10-27T10:00:00.000Z').toLocaleDateString(), accuracy: 0, engine: 'Cloud AI' },
        ]);
    });
});