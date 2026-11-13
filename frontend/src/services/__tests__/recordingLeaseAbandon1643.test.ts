/**
 * #1643 missing-Start (Sam, 2026-11-12): a Start that failed or was cancelled before it recorded anything settles its
 * exact lease as ABANDONED on the server instead of only releasing it. The server proves no take exists and fences the
 * identity (tests/db/recording-start-abandonment-realpg.test.mjs); this is the client contract: exact lease, never a newer
 * take's, and never weaker than the ordinary release.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    acquireTakeLease,
    currentTakeLeaseId,
    releaseTakeLease,
    startLeaseHeartbeat,
    __resetTakeLeaseForTests,
    type LeaseRpc,
} from '../recordingLease';

type Call = { fn: string; args: Record<string, unknown> };
type Handler = (args: Record<string, unknown>) => { data?: unknown; error?: unknown } | Promise<never>;

function fakeRpc(handlers: Partial<Record<string, Handler>>) {
    const calls: Call[] = [];
    const rpc: LeaseRpc = async (fn, args) => {
        calls.push({ fn, args });
        const handler = handlers[fn];
        if (!handler) return { data: null, error: { message: `no handler for ${fn}` } };
        const out = await handler(args);
        return { data: out.data ?? null, error: out.error ?? null };
    };
    return { rpc, calls };
}

const ACQUIRED = { acquire_recording_lease: () => ({ data: { acquired: true, took_over: false } }) };

beforeEach(() => { __resetTakeLeaseForTests(); vi.useFakeTimers(); });
afterEach(() => { __resetTakeLeaseForTests(); vi.useRealTimers(); });

describe('#1643 releaseTakeLease({ startFailed }) — settle a Start that never recorded', () => {
    it('abandons exactly the Start\'s lease, forgets it and stops its heartbeat, and makes no release call', async () => {
        const { rpc, calls } = fakeRpc({ ...ACQUIRED, abandon_recording_start_v1: () => ({ data: { abandoned: true, outcome: 'abandoned_not_recorded', repeated: false } }) });
        await acquireTakeLease({ rpc });
        const lease = currentTakeLeaseId()!;
        startLeaseHeartbeat(() => undefined, { rpc, intervalMs: 1000 });
        await releaseTakeLease({ rpc, startFailed: lease });
        expect(currentTakeLeaseId()).toBeNull();
        expect(calls.slice(1)).toEqual([{ fn: 'abandon_recording_start_v1', args: { p_lease_id: lease } }]);
        await vi.advanceTimersByTimeAsync(5000);
        expect(calls.filter((c) => c.fn === 'heartbeat_recording_lease'), 'the heartbeat stopped with the settlement').toHaveLength(0);
    });

    it('a repeated settlement the server already recorded is still a settlement (no release)', async () => {
        const { rpc, calls } = fakeRpc({ abandon_recording_start_v1: () => ({ data: { abandoned: true, outcome: 'abandoned_not_recorded', repeated: true } }) });
        await releaseTakeLease({ rpc, startFailed: 'lease-a' });
        expect(calls.map((c) => c.fn)).toEqual(['abandon_recording_start_v1']);
    });

    it.each([
        ['the server refuses because a take exists', { data: { abandoned: false, reason: 'take_exists' } }],
        ['the server does not know the identity', { data: { abandoned: false, reason: 'unknown_identity' } }],
        ['the server predates the function (PGRST202)', { error: { code: 'PGRST202', message: 'not found' } }],
        ['the server errors', { error: { message: 'boom' } }],
        ['the answer is malformed', { data: { abandoned: 'yes' } }],
        ['the answer is empty', { data: null }],
    ])('CASUALTY: when %s, the same lease is released exactly as before — never weaker than a release', async (_label, answer) => {
        const { rpc, calls } = fakeRpc({ ...ACQUIRED, abandon_recording_start_v1: () => answer, release_recording_lease: () => ({ data: { released: true } }) });
        await acquireTakeLease({ rpc });
        const lease = currentTakeLeaseId()!;
        await releaseTakeLease({ rpc, startFailed: lease });
        expect(currentTakeLeaseId()).toBeNull();
        expect(calls.slice(1)).toEqual([
            { fn: 'abandon_recording_start_v1', args: { p_lease_id: lease } },
            { fn: 'release_recording_lease', args: { p_lease_id: lease } },
        ]);
    });

    it('CASUALTY: a throwing transport still falls back to the release and never throws', async () => {
        const calls: string[] = [];
        const rpc: LeaseRpc = async (fn) => { calls.push(fn); throw new Error('network'); };
        await expect(releaseTakeLease({ rpc, startFailed: 'lease-a' })).resolves.toBeUndefined();
        expect(calls).toEqual(['abandon_recording_start_v1', 'release_recording_lease']);
    });

    it('CASUALTY: an older Start\'s settlement never touches a newer take\'s held lease or heartbeat', async () => {
        const { rpc, calls } = fakeRpc({ ...ACQUIRED, abandon_recording_start_v1: () => ({ data: { abandoned: true } }), heartbeat_recording_lease: () => ({ data: { valid: true } }) });
        await acquireTakeLease({ rpc });
        const newer = currentTakeLeaseId()!;
        startLeaseHeartbeat(() => undefined, { rpc, intervalMs: 1000 });
        await releaseTakeLease({ rpc, startFailed: 'older-start-lease' });
        expect(currentTakeLeaseId()).toBe(newer);
        expect(calls.find((c) => c.fn === 'abandon_recording_start_v1')?.args).toEqual({ p_lease_id: 'older-start-lease' });
        expect(calls.some((c) => c.fn === 'release_recording_lease')).toBe(false);
        await vi.advanceTimersByTimeAsync(1000);
        expect(calls.filter((c) => c.fn === 'heartbeat_recording_lease' && c.args.p_lease_id === newer)).toHaveLength(1);
    });

    it('CONTROL: an ordinary release (no startFailed) never calls the abandonment', async () => {
        const { rpc, calls } = fakeRpc({ ...ACQUIRED, release_recording_lease: () => ({ data: { released: true } }) });
        await acquireTakeLease({ rpc });
        const lease = currentTakeLeaseId()!;
        await releaseTakeLease({ rpc });
        expect(calls.slice(1)).toEqual([{ fn: 'release_recording_lease', args: { p_lease_id: lease } }]);
    });
});
