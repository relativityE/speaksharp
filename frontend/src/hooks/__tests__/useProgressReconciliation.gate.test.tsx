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
import { enqueueProgressReconcile, progressQueueEntryKey, PROGRESS_QUEUE_V2_PREFIX } from '@/services/progress/progressReconcileQueue';
import { PROGRESS_QUEUE_STORAGE_KEY, progressGateNotice, startGateMessage } from '@/services/progress/progressStartGate';

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
/** Resolved FOR the currently signed-in owner ('' marks a resolved anonymous visitor). */
const resolved = () => useSessionStore.getState().progressGateResolvedFor === (authUser.user?.id ?? '');

beforeEach(() => {
    localStorage.clear();
    authUser.user = null;
    history.data = [];
    useSessionStore.getState().setProgressGate(null);
    useSessionStore.getState().setProgressGateResolvedFor(null);
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

describe('a reload must not be mistaken for resolution', () => {
    it('RETRACTED CLAIM: an empty queue is NOT proof that nothing is owed', async () => {
        // This file previously asserted the opposite — that a reload finding no queue entry may unlock
        // Start. That was unsafe and it encoded the defect as the contract. The missing entry can mean
        // the OBLIGATION WRITE ITSELF FAILED: session saved, evaluation failed, enqueue failed, gate
        // held only in memory, reload erases the memory. Absence of an entry was being read as proof of
        // completion, which it never was.
        //
        // The fix is a WRITE-AHEAD obligation in the seam: the entry is written and verified BEFORE the
        // evaluation is attempted, so a failed evaluation — or a tab closed mid-attempt — leaves durable
        // debt that a reload reconstructs. This test pins the post-reload behaviour of that journey.
        expect(enqueueProgressReconcile(SESSION, OWNER, 'now').ok).toBe(true);   // the write-ahead entry
        authUser.user = { id: OWNER };

        renderHook(() => useProgressReconciliation());   // stands in for the post-reload mount

        await waitFor(() => expect(resolved()).toBe(true));
        expect(gate(), 'the obligation must survive the reload').toMatchObject({
            sessionId: SESSION, ownerId: OWNER, state: 'queued',
        });
    });

    it('an UNREADABLE queue keeps blocking across reloads — there is NO in-app exit', async () => {
        // While storage cannot be read we cannot distinguish "nothing owed" from "we cannot tell", so it
        // fails closed and stays closed until storage recovers. The controller blocks independently via
        // evaluateDurableStartGate, so clearing the store gate would not help either. There is
        // deliberately no "continue anyway".
        localStorage.setItem(PROGRESS_QUEUE_STORAGE_KEY, '{not json');
        authUser.user = { id: OWNER };

        const first = renderHook(() => useProgressReconciliation());
        await waitFor(() => expect(gate()).not.toBeNull());
        first.unmount();

        useSessionStore.getState().setProgressGate(null);   // a reload starts with an empty store
        renderHook(() => useProgressReconciliation());

        await waitFor(() => expect(resolved()).toBe(true));
        expect(gate(), 'still blocked while the queue is unreadable').toMatchObject({ state: 'unresolved' });
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
        // #1476: the writer writes one v2 key per (owner, session); the listener wakes on that prefix (and on the v1
        // aggregate an older tab may still write).
        expect(enqueueProgressReconcile(SESSION, OWNER, 'now').ok).toBe(true);
        const written = progressQueueEntryKey(OWNER, SESSION);
        expect(localStorage.getItem(written)).not.toBeNull();
        expect(written.startsWith(PROGRESS_QUEUE_V2_PREFIX)).toBe(true);
        expect(PROGRESS_QUEUE_STORAGE_KEY).toBe('ss_progress_reconcile_queue_v1');
    });
});

/**
 * #1533 Codex P2 (PM FIX NOW, 2026-09-26) — a refusal from DURABLE debt while this page's gate is still null. The
 * controller re-reads durable debt at Start, so it can refuse before the per-tab projection arrives. The refusal is
 * the only reason on screen then; it must stay until the same-owner gate notice is published (then it is a duplicate)
 * or until a gate this page observed has cleared (then it is stale). Unrelated errors are never touched.
 */
describe('#1533 — the refusal reason survives a null page gate', () => {
    const REFUSAL = startGateMessage({ allowed: false, reason: 'queued_debt', sessionId: SESSION })!;
    const status = () => useSessionStore.getState().sttStatus;
    const refuse = (message = REFUSAL) => act(() => { useSessionStore.getState().setSTTStatus({ type: 'error', message }); });

    beforeEach(() => { useSessionStore.getState().setSTTStatus({ type: 'idle', message: 'Ready to record' }); });

    it('refused while the page gate is null: the reason stays (no silent click); projection makes it a duplicate and removes it; settlement leaves nothing stale', async () => {
        authUser.user = { id: OWNER };
        renderHook(() => useProgressReconciliation());
        await waitFor(() => expect(resolved()).toBe(true));
        expect(gate()).toBeNull();

        // The controller refused from durable debt this tab has not projected yet.
        refuse();
        await new Promise((r) => setTimeout(r, 20));
        expect(status()).toEqual({ type: 'error', message: REFUSAL });

        // The same-owner gate is projected: its notice now says this once, so the red copy goes.
        act(() => { useSessionStore.getState().setProgressGate({ sessionId: SESSION, ownerId: OWNER, state: 'queued' }); });
        await waitFor(() => expect(status().type).toBe('idle'));

        // Settlement precondition, asserted (not vacuous): immediately before the gate clears, the ONLY reason on
        // screen is the gate's own notice — the refusal is absent because publication removed it.
        expect(progressGateNotice(gate(), true)).toBe(REFUSAL);
        expect(status()).toEqual({ type: 'idle', message: 'Ready to record' });

        // Settlement: the gate clears; its notice goes with it and no refusal lingers.
        act(() => { useSessionStore.getState().setProgressGate(null); });
        await new Promise((r) => setTimeout(r, 20));
        expect(progressGateNotice(gate(), true)).toBeNull();
        expect(status()).toEqual({ type: 'idle', message: 'Ready to record' });
    });

    it('PM casualty — BATCHED: an observed gate A clears in the SAME act that a new durable-debt refusal appears → the refusal stays with the page gate null', async () => {
        authUser.user = { id: OWNER };
        renderHook(() => useProgressReconciliation());
        await waitFor(() => expect(resolved()).toBe(true));
        // This page observes same-owner gate A.
        act(() => { useSessionStore.getState().setProgressGate({ sessionId: SESSION, ownerId: OWNER, state: 'queued' }); });
        expect(progressGateNotice(gate(), true)).not.toBeNull();
        expect(status().type).toBe('idle');

        // One update: A clears AND the controller publishes a NEW refusal from durable debt.
        act(() => {
            useSessionStore.getState().setProgressGate(null);
            useSessionStore.getState().setSTTStatus({ type: 'error', message: REFUSAL });
        });
        await new Promise((r) => setTimeout(r, 20));
        expect(gate()).toBeNull();
        expect(status(), 'the new refusal is the only reason on screen and must stay').toEqual({ type: 'error', message: REFUSAL });
    });

    it('BATCHED, the other way: a refusal and its same-owner gate published in the same act → the duplicate refusal goes, the notice shows', async () => {
        authUser.user = { id: OWNER };
        renderHook(() => useProgressReconciliation());
        await waitFor(() => expect(resolved()).toBe(true));
        act(() => {
            useSessionStore.getState().setSTTStatus({ type: 'error', message: REFUSAL });
            useSessionStore.getState().setProgressGate({ sessionId: SESSION, ownerId: OWNER, state: 'queued' });
        });
        await waitFor(() => expect(status().type).toBe('idle'));
        expect(progressGateNotice(gate(), true)).toBe(REFUSAL);
    });

    it('a NEW refusal after the earlier gate already settled (gate still null) keeps its reason — no stale observation clears it', async () => {
        authUser.user = { id: OWNER };
        renderHook(() => useProgressReconciliation());
        await waitFor(() => expect(resolved()).toBe(true));
        act(() => { useSessionStore.getState().setProgressGate({ sessionId: SESSION, ownerId: OWNER, state: 'queued' }); });
        act(() => { useSessionStore.getState().setProgressGate(null); });
        refuse();
        await new Promise((r) => setTimeout(r, 20));
        expect(status()).toEqual({ type: 'error', message: REFUSAL });
    });

    it('another owner\'s gate never clears this owner\'s refusal', async () => {
        authUser.user = { id: OWNER };
        renderHook(() => useProgressReconciliation());
        await waitFor(() => expect(resolved()).toBe(true));
        refuse();
        act(() => { useSessionStore.getState().setProgressGate({ sessionId: 'x', ownerId: OTHER, state: 'queued' }); });
        await new Promise((r) => setTimeout(r, 20));
        expect(status()).toEqual({ type: 'error', message: REFUSAL });
    });

    it('unrelated errors are preserved through gate publication and settlement', async () => {
        authUser.user = { id: OWNER };
        renderHook(() => useProgressReconciliation());
        await waitFor(() => expect(resolved()).toBe(true));
        refuse('Microphone access was denied.');
        act(() => { useSessionStore.getState().setProgressGate({ sessionId: SESSION, ownerId: OWNER, state: 'queued' }); });
        act(() => { useSessionStore.getState().setProgressGate(null); });
        await new Promise((r) => setTimeout(r, 20));
        expect(status()).toEqual({ type: 'error', message: 'Microphone access was denied.' });
    });
});
