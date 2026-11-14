// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ functions: { invoke } }) }));
vi.mock('@/contexts/AuthProvider', () => ({
    useAuthProvider: () => ({ user: { id: 'owner' }, session: { access_token: 't' } }),
}));
import { useCachedUsageLimit, useUsageLimit } from '../useUsageLimit';

/** PO 2026-11-14 payment wall: the root reconciler gate reads the entitlement cache and never calls the server. */
describe('useCachedUsageLimit', () => {
    beforeEach(() => invoke.mockReset());
    const wrap = (client: QueryClient) => ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    it('never calls check-usage-limit, even on mount or window focus', async () => {
        const client = new QueryClient();
        const { result } = renderHook(() => useCachedUsageLimit(), { wrapper: wrap(client) });
        window.dispatchEvent(new Event('focus'));
        await new Promise(r => setTimeout(r, 20));
        expect(invoke).not.toHaveBeenCalled();
        expect(result.current.data).toBeUndefined();
    });

    it("reflects the answer useUsageLimit stored for this user, including a later refusal", async () => {
        const client = new QueryClient();
        client.setQueryData(['usageLimit', 'owner'], { can_start: true });
        const { result } = renderHook(() => useCachedUsageLimit(), { wrapper: wrap(client) });
        expect(result.current.data?.can_start).toBe(true);
        client.setQueryData(['usageLimit', 'owner'], { can_start: false, error: 'trial_expired' });
        await waitFor(() => expect(result.current.data?.can_start).toBe(false));
        expect(invoke).not.toHaveBeenCalled();
    });

    it('a key-wide invalidation still runs the real check when the cache-only reader registered last', async () => {
        invoke.mockResolvedValue({ data: { can_start: true }, error: null });
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const { result } = renderHook(() => ({ live: useUsageLimit(), cached: useCachedUsageLimit() }), { wrapper: wrap(client) });
        await waitFor(() => expect(result.current.live.data?.can_start).toBe(true));
        invoke.mockClear();
        await client.invalidateQueries({ queryKey: ['usageLimit'] });
        await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
        expect(result.current.live.error).toBeNull();
    });
});
