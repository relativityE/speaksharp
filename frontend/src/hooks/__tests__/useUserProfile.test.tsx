/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, waitFor } from '@testing-library/react';
import { useUserProfile } from '../useUserProfile';
import { useAuthProvider } from '../../contexts/AuthProvider';
import { getSupabaseClient } from '../../lib/supabaseClient';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

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

describe('useUserProfile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        queryClient.clear();
    });

    it('should return null when no user is authenticated', async () => {
        (useAuthProvider as any).mockReturnValue({ user: null });

        const { result } = renderHook(() => useUserProfile(), { wrapper });

        await waitFor(() => expect(result.current.data).toBeUndefined());
    });

    it('should fetch and return user profile when user is authenticated', async () => {
        const mockUser = { id: 'test-user-id' };
        const mockProfile = { id: 'test-user-id', subscription_status: 'pro' };

        (useAuthProvider as any).mockReturnValue({ user: mockUser });

        const mockSelect = vi.fn().mockReturnThis();
        const mockEq = vi.fn().mockReturnThis();
        const mockSingle = vi.fn().mockResolvedValue({ data: mockProfile, error: null });

        (getSupabaseClient as any).mockReturnValue({
            from: vi.fn().mockReturnValue({
                select: mockSelect,
                eq: mockEq,
                single: mockSingle,
            }),
        });

        const { result } = renderHook(() => useUserProfile(), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(mockProfile);
        expect(getSupabaseClient).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
        const mockUser = { id: 'test-user-id' };
        (useAuthProvider as any).mockReturnValue({ user: mockUser });

        const mockSelect = vi.fn().mockReturnThis();
        const mockEq = vi.fn().mockReturnThis();
        const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'Error fetching' } });

        (getSupabaseClient as any).mockReturnValue({
            from: vi.fn().mockReturnValue({
                select: mockSelect,
                eq: mockEq,
                single: mockSingle,
            }),
        });

        const { result } = renderHook(() => useUserProfile(), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toBeNull();
    });
});
