/* @vitest-environment jsdom */
// #1354 ACCEPTANCE CASE 4 — reload recovery, cross-tab, and the canonical storage key.
//
// The reload/cross-tab helpers existed but were NEVER INSTALLED in the product lifecycle: nothing
// called `reconstructGateFromQueue` or `subscribeCrossTabProgressGate` outside their own module. A
// reload therefore rendered an enabled Start on a session that still owed durable Progress evidence.
//
// Real localStorage, real queue, real store. Only the auth/history providers are mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSessionStore } from '@/stores/useSessionStore';
import { enqueueProgressReconcile } from '@/services/progress/progressReconcileQueue';
import { PROGRESS_QUEUE_STORAGE_KEY } from '@/services/progress/progressStartGate';

const authUser: { user: { id: string } | null } = { user: null };
vi.mock('../../contexts/AuthProvider', () => ({ useAuthProvider: () => authUser }));
const history: { data: unknown[] } = { data: [] };
vi.mock('../usePracticeHistory', () => ({ usePracticeHistory: () => history }));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ rpc: vi.fn(), from: () => ({}) }) }));

const { useProgressReconciliation } = await import('../useProgressReconciliation');

const OWNER = 'user-A';
const OTHER = 'user-B';
const SESSION = 'sess-owed';
const gate = () => useSessionStore.getState().progressGate;
const resolved = () => useSessionStore.getState().progressGateResolved;

beforeEach(() => {
    localStorage.clear();
    authUser.user = null;
    history.data = [];
    useSessionStore.getState().setProgressGate(null);
    useSessionStore.getState().setProgressGateResolved(false);
});

describe('reload recovery reconstructs the gate from durable debt', () => {
    it('publishes a blocked gate for debt this owner still owes', async () => {
        expect(enqueueProgressReconcile(SESSION, OWNER, 'now').ok).toBe(true);
        authUser.user = { id: OWNER };

        renderHook(() => useProgressReconciliation());

        await waitFor(() => expect(resolved()).toBe(true));
        expect(gate()).toMatchObject({ sessionId: SESSION, ownerId: OWNER, state: 'queued' });
    });

    it('reconstructs even with an EMPTY session list', async () => {
        // The reconciliation effect returns early when there are no sessions. Debt is owner-scoped
        // localStorage and exists independently of loaded history, so tying reconstruction to that
        // list would leave exactly the unguarded window this closes.
        expect(enqueueProgressReconcile(SESSION, OWNER, 'now').ok).toBe(true);
        authUser.user = { id: OWNER };
        history.data = [];

        renderHook(() => useProgressReconciliation());

        await waitFor(() => expect(gate()).not.toBeNull());
        expect(gate()).toMatchObject({ sessionId: SESSION, state: 'queued' });
    });

    it('FAILS CLOSED when the queue cannot be read', async () => {
        localStorage.setItem(PROGRESS_QUEUE_STORAGE_KEY, '{not json');
        authUser.user = { id: OWNER };

        renderHook(() => useProgressReconciliation());

        await waitFor(() => expect(resolved()).toBe(true));
        // "We could not tell" is not "nothing is owed".
        expect(gate()).toMatchObject({ ownerId: OWNER, state: 'unresolved' });
    });

    it('another account\'s debt does not block this user', async () => {
        expect(enqueueProgressReconcile(SESSION, OTHER, 'now').ok).toBe(true);
        authUser.user = { id: OWNER };

        renderHook(() => useProgressReconciliation());

        await waitFor(() => expect(resolved()).toBe(true));
        expect(gate()).toBeNull();
    });

    it('with NO owner the question still RESOLVES, so Start is not disabled forever', async () => {
        authUser.user = null;

        renderHook(() => useProgressReconciliation());

        await waitFor(() => expect(resolved()).toBe(true));
        expect(gate()).toBeNull();
    });
});

describe('cross-tab', () => {
    it('a queue change in ANOTHER tab republishes this tab\'s gate', async () => {
        authUser.user = { id: OWNER };
        renderHook(() => useProgressReconciliation());
        await waitFor(() => expect(resolved()).toBe(true));
        expect(gate()).toBeNull();

        // The other tab queues debt; this tab is notified by a `storage` event and RE-READS the queue
        // rather than trusting the event payload.
        expect(enqueueProgressReconcile(SESSION, OWNER, 'now').ok).toBe(true);
        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: PROGRESS_QUEUE_STORAGE_KEY }));
        });

        expect(gate()).toMatchObject({ sessionId: SESSION, state: 'queued' });
    });

    it('an unrelated storage key is ignored', async () => {
        authUser.user = { id: OWNER };
        renderHook(() => useProgressReconciliation());
        await waitFor(() => expect(resolved()).toBe(true));

        expect(enqueueProgressReconcile(SESSION, OWNER, 'now').ok).toBe(true);
        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: 'some_other_app_key' }));
        });

        expect(gate(), 'an unrelated key must not trigger a re-read').toBeNull();
    });

    it('the listener is removed on unmount', async () => {
        authUser.user = { id: OWNER };
        const { unmount } = renderHook(() => useProgressReconciliation());
        await waitFor(() => expect(resolved()).toBe(true));
        unmount();

        expect(enqueueProgressReconcile(SESSION, OWNER, 'now').ok).toBe(true);
        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: PROGRESS_QUEUE_STORAGE_KEY }));
        });

        expect(gate()).toBeNull();
    });
});

describe('the storage key has ONE production authority', () => {
    it('the key the listener filters on is the key the writer actually writes', () => {
        // Two literals for one key can drift, and a listener filtering on a key the writer no longer
        // uses would silently stop firing while every test that stubs both still passed.
        expect(enqueueProgressReconcile(SESSION, OWNER, 'now').ok).toBe(true);
        expect(localStorage.getItem(PROGRESS_QUEUE_STORAGE_KEY)).not.toBeNull();
    });
});
