/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, waitFor, act } from '@testing-library/react';
import { useCustomVocabulary } from '../useCustomVocabulary';
import { useAuthProvider, AuthContextType } from '../../contexts/AuthProvider';
import { getSupabaseClient } from '../../lib/supabaseClient';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../contexts/AuthProvider');
vi.mock('../../lib/supabaseClient');

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: false,
        },
    },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient} > {children} </QueryClientProvider>
);

const mockUser = { id: 'test-user', email: 'test@example.com' };

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
            signOut: vi.fn(),
            setSession: vi.fn(),
            profile: null,
        } as AuthContextType);
        vi.mocked(getSupabaseClient).mockReturnValue(null as any);

        const { result } = renderHook(() => useCustomVocabulary(), { wrapper });

        await waitFor(() => expect(result.current.vocabulary).toEqual([]));
    });

    it('should fetch vocabulary for authenticated user', async () => {
        vi.mocked(useAuthProvider).mockReturnValue({
            user: mockUser,
            session: {} as any, // Mock session as needed
            loading: false,
            signOut: vi.fn(),
            setSession: vi.fn(),
        } as AuthContextType);

        const mockVocab = [{ id: '1', word: 'test', user_id: 'test-user', created_at: new Date().toISOString() }];

        const mockSelect = vi.fn().mockReturnThis();
        const mockEq = vi.fn().mockReturnThis();
        const mockOrder = vi.fn().mockResolvedValue({ data: mockVocab, error: null });

        vi.mocked(getSupabaseClient).mockReturnValue({
            from: vi.fn().mockReturnValue({
                select: mockSelect,
                eq: mockEq,
                order: mockOrder,
            }),
        } as any); // Cast to any for partial mock

        const { result } = renderHook(() => useCustomVocabulary(), { wrapper });

        await waitFor(() => expect(result.current.vocabulary).toEqual(mockVocab));
        expect(result.current.vocabularyWords).toEqual(['test']);
    });

    it('should validate word before adding', async () => {
        vi.mocked(useAuthProvider).mockReturnValue({
            user: mockUser,
            session: {} as any,
            loading: false,
            signOut: vi.fn(),
            setSession: vi.fn(),
            profile: null,
        } as AuthContextType);
        vi.mocked(getSupabaseClient).mockReturnValue({} as any); // Mock client as needed

        const { result } = renderHook(() => useCustomVocabulary(), { wrapper });

        act(() => {
            result.current.addWord('');
        });

        await waitFor(() => expect(result.current.addError).toBeTruthy());
        expect(result.current.addError?.message).toBe('Word cannot be empty');

        act(() => {
            result.current.addWord('invalid@word');
        });

        await waitFor(() => expect(result.current.addError?.message).toBe('Word can only contain letters, numbers, hyphens, and apostrophes'));
    });
});
