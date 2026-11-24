/**
 * J7.c run 45364395660: a cold Start failed while the browser was offline, and its one abandon call never reached the
 * server, so the lease's admitted save obligation stayed open and the run-owned cleanup guard (correctly) refused to
 * delete the account. The client now keeps that exact lease and retries the same owner RPC when the browser is back
 * online, and before the next release or acquire. Only the server's own answer ends it; the server still proves no take
 * exists. Nothing here changes the cleanup guard or settles anything the server has not confirmed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    acquireTakeLease,
    currentTakeLeaseId,
    releaseTakeLease,
    retryUnreachedAbandons,
    __resetTakeLeaseForTests,
    __unreachedAbandonsForTests,
    type LeaseRpc,
} from '../recordingLease';

type Call = { fn: string; lease: unknown };

/** An rpc whose network can be cut, and whose abandon answer can be set per test. */
function network(abandonAnswer: () => { data?: unknown; error?: unknown } = () => ({ data: { abandoned: true, outcome: 'abandoned_not_recorded', repeated: false } })) {
    const state = { online: true };
    const calls: Call[] = [];
    const rpc: LeaseRpc = async (fn, args) => {
        calls.push({ fn, lease: args.p_lease_id });
        if (!state.online) throw new TypeError('Failed to fetch');
        if (fn === 'acquire_recording_lease') return { data: { acquired: true, took_over: false }, error: null };
        if (fn === 'abandon_recording_start_v1') { const a = abandonAnswer(); return { data: a.data ?? null, error: a.error ?? null }; }
        return { data: { released: true }, error: null };
    };
    return { rpc, calls, state, of: (fn: string) => calls.filter((c) => c.fn === fn) };
}

const settle = async () => { await retryUnreachedAbandons(); };
// Only the browser's own event: the retry must be started by the listener, not by the test.
const tick = () => new Promise((r) => setTimeout(r, 0));
const goOnline = async () => { window.dispatchEvent(new Event('online')); for (let i = 0; i < 5; i += 1) await tick(); };

beforeEach(() => { __resetTakeLeaseForTests(); });
afterEach(() => { __resetTakeLeaseForTests(); });

describe('J7.c: a failed Start\'s abandon that never reached the server is retried on reconnect', () => {
    it('offline failure, then back online: the SAME lease is abandoned once the server can hear it, and forgotten', async () => {
        const net = network();
        await acquireTakeLease({ rpc: net.rpc });
        const cold = currentTakeLeaseId()!;
        net.state.online = false;
        await releaseTakeLease({ rpc: net.rpc, startFailed: cold });
        expect(__unreachedAbandonsForTests()).toEqual([cold]);
        net.state.online = true;
        await goOnline();
        expect(net.of('abandon_recording_start_v1').map((c) => c.lease)).toEqual([cold, cold]);
        expect(__unreachedAbandonsForTests()).toEqual([]);
        // Settled: no further abandon on later events or releases.
        await goOnline();
        await releaseTakeLease({ rpc: net.rpc });
        expect(net.of('abandon_recording_start_v1')).toHaveLength(2);
    });

    it('the Retry Start after reconnect settles the old Start first, then acquires its own new lease (never the reverse)', async () => {
        const net = network();
        await acquireTakeLease({ rpc: net.rpc });
        const cold = currentTakeLeaseId()!;
        net.state.online = false;
        await releaseTakeLease({ rpc: net.rpc, startFailed: cold });
        net.state.online = true; // no `online` event delivered (e.g. it raced the click)
        await acquireTakeLease({ rpc: net.rpc });
        const retry = currentTakeLeaseId()!;
        expect(retry).not.toBe(cold);
        const tail = net.calls.slice(-2);
        expect(tail).toEqual([{ fn: 'abandon_recording_start_v1', lease: cold }, { fn: 'acquire_recording_lease', lease: retry }]);
        expect(currentTakeLeaseId(), 'the new take keeps its lease').toBe(retry);
    });

    it('CASUALTY: a retry never abandons or releases the newer take\'s lease', async () => {
        let refuse = false;
        const net = network(() => (refuse ? { data: { abandoned: false, reason: 'take_exists' } } : { error: { message: 'offline' } }));
        await releaseTakeLease({ rpc: net.rpc, startFailed: 'cold-start' });
        await acquireTakeLease({ rpc: net.rpc }); // still unreached: kept
        const newer = currentTakeLeaseId()!;
        refuse = true;
        await goOnline();
        expect(net.of('abandon_recording_start_v1').every((c) => c.lease === 'cold-start')).toBe(true);
        expect(net.of('release_recording_lease').map((c) => c.lease)).toEqual(['cold-start', 'cold-start']);
        expect(currentTakeLeaseId()).toBe(newer);
    });

    it('a definite refusal on retry (a take exists) ends the retry and releases that same lease, as before', async () => {
        let answer: { data?: unknown; error?: unknown } = { error: { message: 'offline' } };
        const net = network(() => answer);
        await releaseTakeLease({ rpc: net.rpc, startFailed: 'lease-a' });
        expect(__unreachedAbandonsForTests()).toEqual(['lease-a']);
        answer = { data: { abandoned: false, reason: 'take_exists' } };
        await goOnline();
        expect(__unreachedAbandonsForTests()).toEqual([]);
        expect(net.calls.slice(-2)).toEqual([{ fn: 'abandon_recording_start_v1', lease: 'lease-a' }, { fn: 'release_recording_lease', lease: 'lease-a' }]);
    });

    it.each([
        ['a take exists', { data: { abandoned: false, reason: 'take_exists' } }],
        ['unknown identity (another account, or no obligation)', { data: { abandoned: false, reason: 'unknown_identity' } }],
        ['signed out', { data: { abandoned: false, reason: 'unauthenticated' } }],
        ['abandoned', { data: { abandoned: true, outcome: 'abandoned_not_recorded' } }],
    ])('CONTROL: when the server answered (%s), nothing is kept for retry', async (_l, a) => {
        const net = network(() => a);
        await releaseTakeLease({ rpc: net.rpc, startFailed: 'lease-a' });
        expect(__unreachedAbandonsForTests()).toEqual([]);
        await goOnline();
        expect(net.of('abandon_recording_start_v1')).toHaveLength(1);
    });

    it.each([
        ['a thrown fetch', 'throw'],
        ['a transport error', { error: { message: 'Failed to fetch' } }],
        ['an empty answer', { data: null }],
        ['a malformed answer', { data: { abandoned: 'yes' } }],
        ['a refusal with no reason', { data: { abandoned: false } }],
    ])('when the abandon got %s, the lease is kept for retry (and still released now, as before)', async (_l, a) => {
        const net = network(() => { if (a === 'throw') throw new TypeError('Failed to fetch'); return a as { data?: unknown }; });
        await releaseTakeLease({ rpc: net.rpc, startFailed: 'lease-a' });
        expect(__unreachedAbandonsForTests()).toEqual(['lease-a']);
        expect(net.calls).toEqual([{ fn: 'abandon_recording_start_v1', lease: 'lease-a' }, { fn: 'release_recording_lease', lease: 'lease-a' }]);
    });

    it('bounded: a server that never answers costs five retries, then the lease is left to the existing cleanup', async () => {
        const net = network(() => ({ error: { code: 'PGRST202', message: 'not found' } }));
        await releaseTakeLease({ rpc: net.rpc, startFailed: 'lease-a' });
        for (let i = 0; i < 8; i += 1) await goOnline();
        expect(net.of('abandon_recording_start_v1')).toHaveLength(1 + 5);
        expect(__unreachedAbandonsForTests()).toEqual([]);
    });

    it('concurrent reconnect and Retry share one retry pass: the old lease is abandoned once, not twice', async () => {
        const net = network();
        net.state.online = false;
        await releaseTakeLease({ rpc: net.rpc, startFailed: 'lease-a' });
        net.state.online = true;
        window.dispatchEvent(new Event('online'));
        await acquireTakeLease({ rpc: net.rpc });
        await settle();
        expect(net.of('abandon_recording_start_v1').map((c) => c.lease)).toEqual(['lease-a', 'lease-a']);
    });

    it('never throws, online or not', async () => {
        const rpc: LeaseRpc = async () => { throw new Error('network'); };
        await expect(releaseTakeLease({ rpc, startFailed: 'lease-a' })).resolves.toBeUndefined();
        window.dispatchEvent(new Event('online'));
        await expect(retryUnreachedAbandons()).resolves.toBeUndefined();
    });
});
