import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let currentUser: { id: string } | null = { id: 'A' };
vi.mock('../../contexts/AuthProvider', () => ({ useAuthProvider: () => ({ user: currentUser }) }));

const getRecentReviewable = vi.fn();
vi.mock('@/services/domainServices', () => ({
    sessionService: { getRecentReviewable: (...args: unknown[]) => getRecentReviewable(...args) },
}));

import { useRecentPracticeSummary } from '../useRecentPracticeSummary';

const wrapper = (client: QueryClient) =>
    ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const row = (id: string) => ({ id, created_at: '2026-07-20T00:00:00.000Z', duration: 100, status: 'completed' });

describe('useRecentPracticeSummary (#1042 PR4)', () => {
    beforeEach(() => {
        getRecentReviewable.mockReset();
        currentUser = { id: 'A' };
        document.documentElement.removeAttribute('data-session-persisted');
    });

    it('keys by user id and calls the narrow service with that id', async () => {
        getRecentReviewable.mockResolvedValue([row('s-A')]);
        const qc = newClient();
        const { result } = renderHook(() => useRecentPracticeSummary(), { wrapper: wrapper(qc) });
        await waitFor(() => expect(result.current.data).toHaveLength(1));
        expect(getRecentReviewable).toHaveBeenCalledWith('A');
        expect(qc.getQueryData(['recentPracticeSummary', 'A'])).toBeTruthy();
    });

    it('account switch + late-response isolation: a slow user-A response never becomes user-B data', async () => {
        let resolveA: (v: unknown) => void = () => {};
        getRecentReviewable.mockImplementation((id: string) =>
            id === 'A' ? new Promise((res) => { resolveA = res; }) : Promise.resolve([row('s-B')]));
        const qc = newClient();
        const { result, rerender } = renderHook(() => useRecentPracticeSummary(), { wrapper: wrapper(qc) });

        // Switch to user B before A resolves.
        currentUser = { id: 'B' };
        rerender();
        await waitFor(() => expect((result.current.data as Array<{ id: string }> | undefined)?.[0]?.id).toBe('s-B'));

        // A's late response now arrives — it lands in A's cache entry, NOT B's; the hook (keyed to B) stays B.
        resolveA([row('s-A')]);
        await Promise.resolve();
        expect((result.current.data as Array<{ id: string }> | undefined)?.[0]?.id).toBe('s-B');
        expect((qc.getQueryData(['recentPracticeSummary', 'B']) as Array<{ id: string }>)[0].id).toBe('s-B');
    });

    it('is disabled with no user (never queries an unauthenticated session)', async () => {
        currentUser = null;
        const qc = newClient();
        const { result } = renderHook(() => useRecentPracticeSummary(), { wrapper: wrapper(qc) });
        await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
        expect(getRecentReviewable).not.toHaveBeenCalled();
    });

    it('post-persist freshness: refetches on mount despite a cached value (never serves a stale session)', async () => {
        const qc = newClient();
        // Pre-seed a prior result, as if cached from an earlier visit.
        qc.setQueryData(['recentPracticeSummary', 'A'], [row('s-old')]);
        document.documentElement.setAttribute('data-session-persisted', 'true');
        getRecentReviewable.mockResolvedValue([row('s-new')]);
        const { result } = renderHook(() => useRecentPracticeSummary(), { wrapper: wrapper(qc) });
        // The "session just persisted" flag forces a refetch on mount even though a cached value exists.
        await waitFor(() => expect(getRecentReviewable).toHaveBeenCalledWith('A'));
        await waitFor(() => expect((result.current.data as Array<{ id: string }> | undefined)?.[0]?.id).toBe('s-new'));
    });
});
