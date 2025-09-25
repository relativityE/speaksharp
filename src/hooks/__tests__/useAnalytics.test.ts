import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useAnalytics } from '../useAnalytics';
import { supabase } from '@/lib/supabaseClient';

vi.mock('@/lib/supabaseClient', () => ({
    supabase: {
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn(),
    },
}));

const mockSupabase = vi.mocked(supabase);

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
        mockSupabase.from('practice_sessions').select.mockResolvedValueOnce({ data: mockSessions, error: null });

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
            { date: new Date('2023-10-26T10:00:00.000Z').toLocaleDateString(), accuracy: 50, engine: 'On-Device' },
            { date: new Date('2023-10-27T10:00:00.000Z').toLocaleDateString(), accuracy: 50, engine: 'Cloud AI' },
        ]);
    });
});