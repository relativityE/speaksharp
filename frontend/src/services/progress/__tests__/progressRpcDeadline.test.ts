/* @vitest-environment jsdom */
// #1354 — a Progress RPC that NEVER SETTLES must not hang the completion path.
//
// Three attempts bound the COUNT, not the TIME. Without a per-attempt deadline a dead connection
// leaves the session never finishing, the gate stuck on `resolving`, and the user unable to record
// again OR to reach the durable retry that exists for exactly this case.
//
// FAKE TIMERS ARE DELIBERATE HERE (unlike progressReconcileVertical.test.ts, which needs the real
// backoff): the deadline is 10s per attempt plus 250ms/500ms of backoff, so a real-timer test would
// take over 30 seconds. Time is advanced explicitly instead.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SpeechRuntimeController } from '../../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';

const rpc = vi.fn();
const table = () => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'insert', 'upsert']) chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.single = async () => ({ data: null, error: null });
    return chain;
};
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ rpc, from: () => table() }) }));
vi.mock('@/lib/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}));

const { getQueuedSessionIdsForUser } = await import('../progressReconcileQueue');
const { PROGRESS_RPC_ATTEMPT_TIMEOUT_MS } = await import('../recordProgress');

const OWNER = 'user-deadline';
const SESSION = 'sess-deadline';

interface Ctl {
    completeProgressForRecording: (
        ctx: { mode: 'open_mic' }, sessionId: string, attributionStatus: string | undefined, metricsPersisted: boolean,
    ) => Promise<{ kind: string; reason?: string }>;
}
function makeController(): Ctl {
    const c = Object.create(SpeechRuntimeController.prototype) as unknown as Ctl;
    const raw = c as unknown as Record<string, unknown>;
    raw.capturedUserId = OWNER;
    raw.pendingAttributionRetry = null;
    raw.pendingFullSaveRetry = null;
    raw.recordingStartedUnresolved = false;
    return c;
}

beforeEach(() => {
    localStorage.clear();
    rpc.mockReset();
    useSessionStore.getState().setProgressGate(null);
    vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });

describe('a Progress RPC that never settles', () => {
    // Explicit 5s cap: with the deadline in place this finishes in milliseconds (fake timers), so the
    // only way to spend 5s here is the hang itself. Left at vitest's 30s default, removing the deadline
    // failed only after half a minute — a slow red is a worse signal than a fast one.
    it('does NOT hang the completion path — it times out, keeps the debt, and reports queued', { timeout: 5_000 }, async () => {
        // A promise that never resolves. Without the deadline the completion below never settles.
        rpc.mockImplementation(() => new Promise(() => {}));

        let settled = false;
        const completion = makeController()
            .completeProgressForRecording({ mode: 'open_mic' }, SESSION, 'verified', true)
            .then((o) => { settled = true; return o; });

        for (let i = 0; i < 50; i++) await Promise.resolve();
        expect(settled, 'still in flight before any deadline elapses').toBe(false);
        // The write-ahead obligation is already durable, which is what makes timing out safe.
        expect(getQueuedSessionIdsForUser(OWNER).sessionIds).toEqual([SESSION]);

        // Three attempt deadlines plus the 250ms + 500ms backoffs between them.
        await vi.advanceTimersByTimeAsync(PROGRESS_RPC_ATTEMPT_TIMEOUT_MS * 3 + 1_000);
        const outcome = await completion;

        expect(settled, 'the completion path must terminate').toBe(true);
        expect(outcome.kind, 'a durable obligation exists, so this is retryable').toBe('queued');
        expect(getQueuedSessionIdsForUser(OWNER).sessionIds, 'debt survives for reconciliation').toEqual([SESSION]);
        expect(useSessionStore.getState().progressGate).toMatchObject({
            sessionId: SESSION, ownerId: OWNER, state: 'queued',
        });
    });

    it('a response arriving INSIDE the deadline is used normally', async () => {
        // The deadline must not truncate a healthy call.
        rpc.mockImplementation((fn: string) => (fn === 'record_progress_evaluation'
            // Slow but WITHIN the deadline — the guard must not truncate a healthy call.
            ? new Promise((resolve) => { setTimeout(() => resolve({ data: 'eval-1', error: null }), PROGRESS_RPC_ATTEMPT_TIMEOUT_MS / 2); })
            // Downstream recommendation/attempt calls are incidental here and resolve at once.
            : Promise.resolve({ data: null, error: null })));

        const completion = makeController().completeProgressForRecording({ mode: 'open_mic' }, SESSION, 'verified', true);
        await vi.advanceTimersByTimeAsync(PROGRESS_RPC_ATTEMPT_TIMEOUT_MS);
        const outcome = await completion;

        expect(outcome.kind).toBe('recorded');
        expect(getQueuedSessionIdsForUser(OWNER).sessionIds, 'obligation retired').toEqual([]);
        expect(useSessionStore.getState().progressGate).toBeNull();
    });
});
