import { renderHook, waitFor } from '@testing-library/react';
import { useUserProfile } from '../useUserProfile';
import { useAuthProvider } from '../../contexts/AuthProvider';
import { profileService } from '../../services/domainServices';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest';

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
        (useAuthProvider as unknown as Mock).mockReturnValue({ session: null });

        const { result } = renderHook(() => useUserProfile(), { wrapper });

        await waitFor(() => expect(result.current.data).toBeUndefined());
    });

    it('should fetch and return user profile when user is authenticated', async () => {
        const mockUser = { id: 'test-user-id' };
        const mockProfile = { id: 'test-user-id', subscription_status: 'pro' };

        (useAuthProvider as unknown as Mock).mockReturnValue({ session: { user: mockUser } });
        (profileService.getById as unknown as Mock).mockResolvedValue(mockProfile);

        const { result } = renderHook(() => useUserProfile(), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(mockProfile);
        expect(profileService.getById).toHaveBeenCalledWith('test-user-id');
    });

    it('should handle errors gracefully with injectable retry disabled', async () => {
        const mockUser = { id: 'test-user-id' };
        const mockError = new Error('Network error');

        (useAuthProvider as unknown as Mock).mockReturnValue({ session: { user: mockUser } });
        (profileService.getById as unknown as Mock).mockRejectedValue(mockError);

        // Use injectable retry: false to skip retries and make test fast
        const { result } = renderHook(() => useUserProfile({ retry: false }), { wrapper });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error).toEqual(mockError);
        expect(result.current.data).toBeUndefined();
        // Verify service was called
        expect(profileService.getById).toHaveBeenCalledWith('test-user-id');
    });
});

