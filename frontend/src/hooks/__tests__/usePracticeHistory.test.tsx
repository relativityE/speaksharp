/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, waitFor } from '@testing-library/react';
import { usePracticeHistory } from '../usePracticeHistory';
import { useAuthProvider } from '../../contexts/AuthProvider';
import { getSessionHistory } from '../../lib/storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../contexts/AuthProvider', () => ({
    useAuthProvider: vi.fn(),
}));

vi.mock('../../lib/storage', () => ({
    getSessionHistory: vi.fn(),
}));

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

describe('usePracticeHistory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        queryClient.clear();
    });

    it('should not fetch history when no user is authenticated', async () => {
        (useAuthProvider as any).mockReturnValue({ user: null });

        const { result } = renderHook(() => usePracticeHistory(), { wrapper });

        expect(result.current.isLoading).toBe(false); // Should be disabled
        expect(getSessionHistory).not.toHaveBeenCalled();
    });

    it('should fetch history when user is authenticated', async () => {
        const mockUser = { id: 'test-user-id' };
        const mockHistory = [{ id: 'session-1', duration: 60 }];

        (useAuthProvider as any).mockReturnValue({ user: mockUser });
        (getSessionHistory as any).mockResolvedValue(mockHistory);

        const { result } = renderHook(() => usePracticeHistory(), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(mockHistory);
        expect(getSessionHistory).toHaveBeenCalledWith('test-user-id');
    });
});
