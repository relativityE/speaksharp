/* @vitest-environment jsdom */
// #1476 Codex P1 on dae853fb — a FRESH device (empty local queue) must not show an enabled Start over SERVER-side Progress
// debt. The owner is resolved only once the server's obligations have been loaded into this device's queue.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSessionStore } from '@/stores/useSessionStore';

const authUser: { user: { id: string } | null } = { user: null };
vi.mock('../../contexts/AuthProvider', () => ({ useAuthProvider: () => authUser }));
vi.mock('../usePracticeHistory', () => ({ usePracticeHistory: () => ({ data: [] }) }));
const server: { answer: ((v: { data: unknown; error: unknown }) => void) | null } = { answer: null };
vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: () => ({
        rpc: (fn: string) => (fn === 'get_progress_obligations'
            ? new Promise((resolve) => { server.answer = resolve; })
            : Promise.resolve({ data: null, error: null })),
        from: () => ({}),
    }),
}));

const { useProgressReconciliation } = await import('../useProgressReconciliation');
const OWNER = 'user-A';

beforeEach(() => {
    localStorage.clear();
    server.answer = null;
    authUser.user = { id: OWNER };
    useSessionStore.getState().setProgressGate(null);
    useSessionStore.getState().setProgressGateResolvedFor(null);
});

describe('#1476 the Start gate waits for the server\'s per-session obligations', () => {
    it('CASUALTY: unresolved while the server answer is pending, then blocked by the remote debt it reports', async () => {
        renderHook(() => useProgressReconciliation());
        await waitFor(() => expect(server.answer).not.toBeNull());
        expect(useSessionStore.getState().progressGateResolvedFor, 'no "nothing owed" answer before the server has spoken').not.toBe(OWNER);

        server.answer?.({ data: [{ session_id: 'sess-remote', state: 'owed', created_at: '2026-09-23T12:00:00.000Z' }], error: null });
        await waitFor(() => expect(useSessionStore.getState().progressGateResolvedFor).toBe(OWNER));
        expect(useSessionStore.getState().progressGate).toMatchObject({ sessionId: 'sess-remote', ownerId: OWNER, state: 'queued' });
    });

    it('CASUALTY (Codex P1 on 0200e7829): an answer that lands AFTER the timeout still publishes the gate — its debt gets the retry', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            renderHook(() => useProgressReconciliation());
            await waitFor(() => expect(server.answer).not.toBeNull());
            await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
            expect(useSessionStore.getState().progressGateResolvedFor, 'the timeout resolves the gate from what is known').toBe(OWNER);
            expect(useSessionStore.getState().progressGate).toBeNull();
            server.answer?.({ data: [{ session_id: 'sess-late', state: 'owed', created_at: '2026-09-23T12:00:00.000Z' }], error: null });
            await waitFor(() => expect(useSessionStore.getState().progressGate).toMatchObject({ sessionId: 'sess-late', ownerId: OWNER, state: 'queued' }));
        } finally { vi.useRealTimers(); }
    });

    it('CONTROL: after the hook unmounts, a late answer writes nothing and publishes nothing', async () => {
        const { unmount } = renderHook(() => useProgressReconciliation());
        await waitFor(() => expect(server.answer).not.toBeNull());
        unmount();
        useSessionStore.getState().setProgressGate(null);
        server.answer?.({ data: [{ session_id: 'sess-orphan', state: 'owed', created_at: '2026-09-23T12:00:00.000Z' }], error: null });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(useSessionStore.getState().progressGate).toBeNull();
        expect(Object.keys(localStorage).some((k) => k.includes('sess-orphan')), 'no orphaned queue entry').toBe(false);
    });
});
