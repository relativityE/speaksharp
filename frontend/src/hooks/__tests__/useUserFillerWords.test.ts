import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { sanitizeUserFillerWords, useUserFillerWords, validateUserFillerWord } from '../useUserFillerWords';

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
            return {
                data: [
                    { id: '1', word: 'basically' },
                    { id: 'malformed' },
                    null
                ],
                isLoading: false,
                error: null
            };
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

describe('sanitizeUserFillerWords', () => {
    it('drops malformed rows before they reach regex/highlight logic', () => {
        expect(sanitizeUserFillerWords([
            { id: '1', word: 'basically', user_id: 'u1', created_at: 'now' },
            { id: '2' },
            { word: 'missing-id' },
            null
        ])).toEqual([{ id: '1', word: 'basically', user_id: 'u1', created_at: 'now' }]);
    });
});

describe('validateUserFillerWord', () => {
    it('allows non-dictionary custom terms', () => {
        expect(validateUserFillerWord('customboost', [], 100, true)).toBe('customboost');
        expect(validateUserFillerWord('um-hmm', [], 100, true)).toBe('um-hmm');
        expect(validateUserFillerWord('like I said', [], 100, true)).toBe('like i said');
        expect(validateUserFillerWord("speaker's note", [], 100, true)).toBe("speaker's note");
    });

    it('normalizes whitespace and casing for matching', () => {
        expect(validateUserFillerWord('  Custom   Boost  ', [], 100, true)).toBe('custom boost');
    });

    it('normalizes added words before persistence', () => {
        expect(validateUserFillerWord('  AntigravityUI  ', [], 100, true)).toBe('antigravityui');
    });

    it('rejects duplicate words case-insensitively', () => {
        expect(() => validateUserFillerWord(
            'BASICALLY',
            [{ word: 'basically' }],
            100,
            true
        )).toThrow('Word already in list');
    });

    it('rejects words beyond the configured free limit', () => {
        const existingWords = Array.from({ length: 10 }, (_, index) => ({ word: `word${index}` }));

        expect(() => validateUserFillerWord('overflow', existingWords, 10, false))
            .toThrow('Free limit reached (10 words). Upgrade to Pro to add more.');
    });

    it('rejects unsafe or malformed custom terms', () => {
        expect(() => validateUserFillerWord(null, [], 100, true)).toThrow('Word must be text');
        expect(() => validateUserFillerWord('bad\u0000word', [], 100, true)).toThrow('letters, numbers, spaces, hyphens, or apostrophes');
        expect(() => validateUserFillerWord('<script>alert(1)</script>', [], 100, true)).toThrow('letters, numbers, spaces, hyphens, or apostrophes');
        expect(() => validateUserFillerWord('.*', [], 100, true)).toThrow('letters, numbers, spaces, hyphens, or apostrophes');
        expect(() => validateUserFillerWord('a'.repeat(51), [], 100, true)).toThrow('50 characters or fewer');
    });
});
