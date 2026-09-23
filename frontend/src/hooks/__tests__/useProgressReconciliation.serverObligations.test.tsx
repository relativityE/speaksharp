/* @vitest-environment jsdom */
// #1476 Codex P1 on dae853fb — a FRESH device (empty local queue) must not show an enabled Start over SERVER-side Progress
// debt. The owner is resolved only once the server's obligations have been loaded into this device's queue.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
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

        server.answer?.({ data: [{ session_id: 'sess-remote', state: 'owed' }], error: null });
        await waitFor(() => expect(useSessionStore.getState().progressGateResolvedFor).toBe(OWNER));
        expect(useSessionStore.getState().progressGate).toMatchObject({ sessionId: 'sess-remote', ownerId: OWNER, state: 'queued' });
    });
});
