import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUserFillerWords } from '../useUserFillerWords';

// Mock dependencies
vi.mock('../../contexts/AuthProvider', () => ({
    useAuthProvider: () => ({
        session: { user: { id: 'test-user-id' } }
    })
}));

vi.mock('../useUsageLimit', () => ({
    useUsageLimit: () => ({
        data: { subscription_status: 'active', is_pro: true }
    })
}));

vi.mock('../../stores/useSessionStore', () => ({
    useSessionStore: (selector: (state: unknown) => unknown) => selector({ setSTTStatus: vi.fn() })
}));

vi.mock('@/lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn() }
}));

const mockSelect = vi.fn();

const mockDelete = vi.fn();
const mockInsert = vi.fn();

vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: () => ({
        from: () => ({
            select: mockSelect,
            insert: mockInsert,
            delete: mockDelete,
        })
    })
}));

// Mock react-query
const mockInvalidateQueries = vi.fn();
const mockSetQueryData = vi.fn();
const mockMutate = vi.fn();

vi.mock('@tanstack/react-query', () => {
    return {
        useQueryClient: () => ({
            invalidateQueries: mockInvalidateQueries,
            setQueryData: mockSetQueryData
        }),
        useQuery: () => {
            return { data: [{ id: '1', word: 'basically' }], isLoading: false, error: null };
        },
        useMutation: () => {
            return { mutate: mockMutate, isPending: false };
        }
    };
});

describe('useUserFillerWords', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns formatted words and full objects', () => {
        const { result } = renderHook(() => useUserFillerWords());
        
        expect(result.current.userFillerWords).toEqual(['basically']);
        expect(result.current.fullVocabularyObjects).toHaveLength(1);
        expect(result.current.count).toBe(1);
        expect(result.current.isPro).toBe(true);
    });

    it('exposes addWord and removeWord functions', () => {
        const { result } = renderHook(() => useUserFillerWords());
        
        expect(typeof result.current.addWord).toBe('function');
        expect(typeof result.current.removeWord).toBe('function');
    });

});
