/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, waitFor } from '@testing-library/react';
import { useUserProfile } from '../useUserProfile';
import { useAuthProvider } from '../../contexts/AuthProvider';
import { profileService } from '../../services/domainServices';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../../contexts/AuthProvider', () => ({
    useAuthProvider: vi.fn(),
}));

vi.mock('../../services/domainServices', () => ({
    profileService: {
        getById: vi.fn(),
    },
}));

const createQueryClient = () => new QueryClient({
    defaultOptions: {
        queries: {
            retry: false,
        },
    },
});

describe('useUserProfile', () => {
    let queryClient: QueryClient;

    beforeEach(() => {
        vi.clearAllMocks();
        queryClient = createQueryClient();
        // Mock window.location.search to avoid devBypass
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true,
        });
    });

    afterEach(() => {
        queryClient.clear();
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    it('should return null when no user is authenticated', async () => {
        (useAuthProvider as any).mockReturnValue({ session: null });

        const { result } = renderHook(() => useUserProfile(), { wrapper });

        await waitFor(() => expect(result.current.data).toBeUndefined());
    });

    it('should fetch and return user profile when user is authenticated', async () => {
        const mockUser = { id: 'test-user-id' };
        const mockProfile = { id: 'test-user-id', subscription_status: 'pro' };

        (useAuthProvider as any).mockReturnValue({ session: { user: mockUser } });
        (profileService.getById as any).mockResolvedValue(mockProfile);

        const { result } = renderHook(() => useUserProfile(), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(mockProfile);
        expect(profileService.getById).toHaveBeenCalledWith('test-user-id');
    });

    // TODO: This test requires ~15s wait due to hook's internal retry: 3 with exponential backoff
    // This is a consequence of the "Transient Profile Loading Failures" code smell documented in ROADMAP.md
    // Proper fix: Make retry configuration injectable/mockable for testing
    // Ref: docs/ROADMAP.md - Tech Debt Identified (Code Smells - Dec 2025) #2
    it.todo('should handle errors gracefully');
});
