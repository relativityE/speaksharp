import { renderHook, waitFor, act } from '@testing-library/react';
import { useCustomVocabulary } from '../useCustomVocabulary';
import { useAuthProvider, AuthContextType } from '../../contexts/AuthProvider';
import { getSupabaseClient } from '../../lib/supabaseClient';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient, Session } from '@supabase/supabase-js';

// Mock dependencies
vi.mock('../../contexts/AuthProvider', () => ({
    useAuthProvider: vi.fn(),
}));

vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(),
}));

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: false,
        },
    },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('useCustomVocabulary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        queryClient.clear();
    });

    it('should return empty vocabulary when no user', async () => {
        vi.mocked(useAuthProvider).mockReturnValue({
            user: null,
            session: null,
            loading: false,
            profile: null,
        } as Partial<AuthContextType> as AuthContextType);

        vi.mocked(getSupabaseClient).mockReturnValue(null as unknown as SupabaseClient);

        const { result } = renderHook(() => useCustomVocabulary(), { wrapper });

        expect(result.current.vocabulary).toEqual([]);
        expect(result.current.isLoading).toBe(false);
    });

    it('should fetch vocabulary for authenticated user', async () => {
        const mockUser = { id: 'test-user' };
        const mockVocab = [{ id: '1', word: 'test', user_id: 'test-user', created_at: new Date().toISOString() }];

        vi.mocked(useAuthProvider).mockReturnValue({
            user: mockUser,
            session: {} as unknown as Session,
            loading: false,
            profile: null,
        } as Partial<AuthContextType> as AuthContextType);

        const mockSelect = vi.fn().mockReturnThis();
        const mockEq = vi.fn().mockReturnThis();
        mockEq.mockResolvedValue({ data: mockVocab, error: null });

        vi.mocked(getSupabaseClient).mockReturnValue({
            from: vi.fn().mockReturnValue({
                select: mockSelect,
                eq: mockEq,
            }),
        } as unknown as SupabaseClient);

        const { result } = renderHook(() => useCustomVocabulary(), { wrapper });

        await waitFor(() => expect(result.current.vocabulary).toEqual(mockVocab));
    });

    it('should validate word before adding', async () => {
        const mockUser = { id: 'test-user' };

        vi.mocked(useAuthProvider).mockReturnValue({
            user: mockUser,
            session: {} as unknown as Session,
            loading: false,
            profile: null,
        } as Partial<AuthContextType> as AuthContextType);

        vi.mocked(getSupabaseClient).mockReturnValue({} as unknown as SupabaseClient);

        const { result } = renderHook(() => useCustomVocabulary(), { wrapper });

        // Test word validation
        await act(async () => {
            result.current.addWord('ab', { onSuccess: vi.fn() });
        });

        // Word too short, should not call mutation
        expect(result.current.isAdding).toBe(false);
    });
});
