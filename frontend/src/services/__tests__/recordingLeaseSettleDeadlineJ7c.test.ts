/**
 * J7.c, Sam's review 1795522438 finding 2: acquire and release await the shared abandon-retry pass, so a settle call that
 * never answers must not hold a Start or a Stop. Every settle call is bounded by LEASE_SETTLE_RPC_DEADLINE_MS; a call that
 * runs out of time is unreached, so its exact lease stays remembered (uncertain, never assumed settled).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    LEASE_SETTLE_RPC_DEADLINE_MS,
    acquireTakeLease,
    currentTakeLeaseId,
    releaseTakeLease,
    __resetTakeLeaseForTests,
    __unreachedAbandonsForTests,
    type LeaseRpc,
} from '../recordingLease';

type Mode = 'online' | 'offline' | 'hang';

/** An rpc whose abandon and release can each be online, offline (throws) or hung (never resolves). */
function network() {
    const mode: { abandon: Mode; release: Mode; abandonAnswer: unknown } = {
        abandon: 'online', release: 'online', abandonAnswer: { abandoned: true, outcome: 'abandoned_not_recorded', repeated: false },
    };
    const calls: { fn: string; lease: unknown }[] = [];
    const rpc: LeaseRpc = (fn, args) => {
        calls.push({ fn, lease: args.p_lease_id });
        const m = fn === 'abandon_recording_start_v1' ? mode.abandon : fn === 'release_recording_lease' ? mode.release : 'online';
        if (m === 'hang') return new Promise(() => {});
        if (m === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
        if (fn === 'acquire_recording_lease') return Promise.resolve({ data: { acquired: true, took_over: false }, error: null });
        if (fn === 'abandon_recording_start_v1') return Promise.resolve({ data: mode.abandonAnswer, error: null });
        return Promise.resolve({ data: { released: true }, error: null });
    };
    return { rpc, calls, mode, of: (fn: string) => calls.filter((c) => c.fn === fn).map((c) => c.lease) };
}

/** Settle a promise under fake timers: report whether it finished by `ms`. */
async function finishesWithin<T>(p: Promise<T>, ms: number): Promise<boolean> {
    let done = false;
    void p.then(() => { done = true; }, () => { done = true; });
    await vi.advanceTimersByTimeAsync(ms);
    return done;
}

/** A failed offline Start whose abandon never reached the server: its lease is remembered. */
async function strandedStart(net: ReturnType<typeof network>): Promise<string> {
    await acquireTakeLease({ rpc: net.rpc });
    const cold = currentTakeLeaseId()!;
    net.mode.abandon = 'offline'; net.mode.release = 'offline';
    await releaseTakeLease({ rpc: net.rpc, startFailed: cold });
    expect(__unreachedAbandonsForTests()).toEqual([cold]);
    net.mode.release = 'online'; net.mode.abandon = 'online';
    return cold;
}

beforeEach(() => { vi.useFakeTimers(); __resetTakeLeaseForTests(); });
afterEach(() => { __resetTakeLeaseForTests(); vi.useRealTimers(); });

describe('J7.c: a hung settle call cannot block Start or Stop', () => {
    it('never-resolving abandon on the replay path: the next Start (acquire) still completes, at the deadline and not before', async () => {
        const net = network(); const cold = await strandedStart(net);
        net.mode.abandon = 'hang';
        const start = acquireTakeLease({ rpc: net.rpc });
        expect(await finishesWithin(start, LEASE_SETTLE_RPC_DEADLINE_MS - 1), 'still waiting just before the deadline').toBe(false);
        expect(await finishesWithin(start, 1)).toBe(true);
        expect((await start).action).not.toBe('error');
        const next = currentTakeLeaseId();
        expect(next).not.toBeNull(); expect(next).not.toBe(cold);
        expect(__unreachedAbandonsForTests(), 'the uncertain exact lease is kept for the next retry').toEqual([cold]);
        expect(net.of('abandon_recording_start_v1').every((l) => l === cold), 'the new take is never abandoned').toBe(true);
    });

    it('never-resolving abandon on the replay path: Stop (release) still completes and releases the held take', async () => {
        const net = network(); const cold = await strandedStart(net);
        await acquireTakeLease({ rpc: net.rpc }); // abandon online here: the stranded lease settles
        expect(__unreachedAbandonsForTests()).toEqual([]);
        const take = currentTakeLeaseId()!;
        // Strand a second failed Start, then hang the replay.
        net.mode.abandon = 'offline';
        await releaseTakeLease({ rpc: net.rpc, startFailed: take });
        await acquireTakeLease({ rpc: net.rpc }).catch(() => undefined);
        net.mode.abandon = 'hang';
        const held = currentTakeLeaseId()!;
        const stop = releaseTakeLease({ rpc: net.rpc });
        expect(await finishesWithin(stop, LEASE_SETTLE_RPC_DEADLINE_MS)).toBe(true);
        expect(net.of('release_recording_lease')).toContain(held);
        expect(__unreachedAbandonsForTests()).toEqual([take]);
        expect(cold).not.toBe(held);
    });

    it('never-resolving release after a refusal on the replay path: acquire still completes', async () => {
        const net = network(); const cold = await strandedStart(net);
        net.mode.abandonAnswer = { abandoned: false, reason: 'take_exists' };
        net.mode.release = 'hang';
        const start = acquireTakeLease({ rpc: net.rpc });
        expect(await finishesWithin(start, LEASE_SETTLE_RPC_DEADLINE_MS)).toBe(true);
        expect(net.of('release_recording_lease')).toContain(cold);
        expect(__unreachedAbandonsForTests(), 'a server answer ends the retry').toEqual([]);
    });

    it('never-resolving FIRST abandon (the failed Start itself): Stop returns at the deadline and the lease is remembered', async () => {
        const net = network();
        await acquireTakeLease({ rpc: net.rpc });
        const cold = currentTakeLeaseId()!;
        net.mode.abandon = 'hang';
        const stop = releaseTakeLease({ rpc: net.rpc, startFailed: cold });
        expect(await finishesWithin(stop, LEASE_SETTLE_RPC_DEADLINE_MS - 1)).toBe(false);
        expect(await finishesWithin(stop, 1)).toBe(true);
        expect(__unreachedAbandonsForTests()).toEqual([cold]);
        expect(currentTakeLeaseId()).toBeNull();
    });

    it('a timed-out retry costs one of the five tries; once the server answers, the SAME lease is abandoned and forgotten', async () => {
        const net = network(); const cold = await strandedStart(net);
        net.mode.abandon = 'hang';
        await finishesWithin(acquireTakeLease({ rpc: net.rpc }), LEASE_SETTLE_RPC_DEADLINE_MS);
        const take = currentTakeLeaseId()!;
        net.mode.abandon = 'online';
        await finishesWithin(releaseTakeLease({ rpc: net.rpc }), LEASE_SETTLE_RPC_DEADLINE_MS);
        expect(__unreachedAbandonsForTests()).toEqual([]);
        expect(net.of('abandon_recording_start_v1').filter((l) => l === cold), 'first, the timed-out retry, then the answered one').toHaveLength(3);
        expect(net.of('abandon_recording_start_v1')).not.toContain(take);
        expect(net.of('release_recording_lease')).toContain(take);
    });

    it('bounded overall: five hung retries, then the lease is left to the existing cleanup and acquire stops waiting on it', async () => {
        const net = network(); const cold = await strandedStart(net);
        net.mode.abandon = 'hang';
        for (let i = 0; i < 5; i += 1) await finishesWithin(acquireTakeLease({ rpc: net.rpc }), LEASE_SETTLE_RPC_DEADLINE_MS);
        expect(__unreachedAbandonsForTests()).toEqual([]);
        const before = net.of('abandon_recording_start_v1').length;
        expect(await finishesWithin(acquireTakeLease({ rpc: net.rpc }), 0), 'nothing left to wait on').toBe(true);
        expect(net.of('abandon_recording_start_v1')).toHaveLength(before);
        expect(net.of('abandon_recording_start_v1').filter((l) => l === cold)).toHaveLength(1 + 5);
    });
});
