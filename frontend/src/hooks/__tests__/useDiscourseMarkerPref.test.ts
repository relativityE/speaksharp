/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── mocks ───────────────────────────────────────────────────────────────────────────────────────
const mockUpdate = vi.fn();
let mockProfile: { include_discourse_markers?: boolean } | null = { include_discourse_markers: false };

vi.mock('../../contexts/AuthProvider', () => ({
    useAuthProvider: () => ({ session: { user: { id: 'user-1' } } }),
}));
vi.mock('../useProfile', () => ({
    useProfile: () => ({ profile: mockProfile, isVerified: true }),
}));
vi.mock('../../services/domainServices', () => ({
    profileService: { update: (...args: unknown[]) => mockUpdate(...args) },
}));

const mockSetQueryData = vi.fn();
const mockInvalidate = vi.fn();
vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({ setQueryData: mockSetQueryData, invalidateQueries: mockInvalidate }),
    // Minimal useMutation that actually runs mutationFn → onSuccess/onError so we can assert side effects.
    useMutation: (opts: {
        mutationFn: (v: unknown) => Promise<unknown>;
        onSuccess?: (r: unknown) => void;
        onError?: (e: unknown) => void;
    }) => ({
        mutate: async (v: unknown) => {
            try {
                const r = await opts.mutationFn(v);
                opts.onSuccess?.(r);
            } catch (e) {
                opts.onError?.(e);
            }
        },
        isPending: false,
        error: null,
    }),
}));

import { useDiscourseMarkerPref } from '../useDiscourseMarkerPref';

describe('useDiscourseMarkerPref (#1231)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockProfile = { include_discourse_markers: false };
    });

    it('reads false by default (pref off / absent column)', () => {
        const { result } = renderHook(() => useDiscourseMarkerPref());
        expect(result.current.includeDiscourseMarkers).toBe(false);
    });

    it('reads true when the profile has opted in', () => {
        mockProfile = { include_discourse_markers: true };
        const { result } = renderHook(() => useDiscourseMarkerPref());
        expect(result.current.includeDiscourseMarkers).toBe(true);
    });

    it('absent field → false (never throws)', () => {
        mockProfile = {};
        const { result } = renderHook(() => useDiscourseMarkerPref());
        expect(result.current.includeDiscourseMarkers).toBe(false);
    });

    it('setting the pref persists via profileService.update and writes the fresh profile into cache', async () => {
        const updated = { id: 'user-1', include_discourse_markers: true };
        mockUpdate.mockResolvedValue(updated);
        const { result } = renderHook(() => useDiscourseMarkerPref());

        await act(async () => {
            result.current.setIncludeDiscourseMarkers(true);
        });

        expect(mockUpdate).toHaveBeenCalledWith('user-1', { include_discourse_markers: true });
        expect(mockSetQueryData).toHaveBeenCalledWith(['userProfile', 'user-1'], updated);
        expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['userProfile'] });
    });
});
