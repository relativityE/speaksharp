/**
 * J7.c, Elon's independent review (2026-11-24) and Sam's bar for it:
 *  P1: a late release must never release the NEXT take's lease. The lease a release is about is captured and cleared at
 *      the call, before any await (Elon's racing-acquire repro is kept verbatim as the first test).
 *  P2: waits must not add up per remembered lease. Start gets ONE total budget across every pending lease; Stop never
 *      waits on old retries; unanswered leases stay remembered as uncertain, never dropped; the work is bounded per pass
 *      (Elon's DB repro 1795530380: a dropped lease is an open obligation that blocks cleanup and deletion).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    LEASE_SETTLE_RPC_DEADLINE_MS,
    MAX_ABANDONS_PER_PASS,
    acquireTakeLease,
    currentTakeLeaseId,
    releaseTakeLease,
    __resetTakeLeaseForTests,
    __unreachedAbandonsForTests,
    type LeaseRpc,
} from '../recordingLease';

beforeEach(() => { vi.useFakeTimers(); __resetTakeLeaseForTests(); });
afterEach(() => { vi.useRealTimers(); __resetTakeLeaseForTests(); });

it('a late release requested with no lease held never releases the next take\'s lease', async () => {
    let abandon: 'offline' | 'hang' = 'offline'; const released: unknown[] = []; let acquireCalled = false;
    const rpc: LeaseRpc = (fn, args) => {
        if (fn === 'abandon_recording_start_v1') return abandon === 'hang' ? new Promise(() => {}) : Promise.reject(new TypeError('Failed to fetch'));
        if (fn === 'release_recording_lease') { released.push(args.p_lease_id); return Promise.resolve({ data: { released: true }, error: null }); }
        if (fn === 'acquire_recording_lease') { acquireCalled = true; return new Promise((r) => setTimeout(() => r({ data: { acquired: true, took_over: false }, error: null }), 1_000)); }
        return Promise.resolve({ data: null, error: null });
    };
    await releaseTakeLease({ rpc, startFailed: '00000000-0000-4000-8000-000000000001' }); // offline failed Start: remembered
    released.length = 0; abandon = 'hang';
    const acquiring = acquireTakeLease({ rpc });
    for (let i = 0; i < 200 && !acquireCalled; i++) await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(400);
    expect(currentTakeLeaseId()).toBe(null);              // acquire in flight, nothing held
    const lateRelease = releaseTakeLease({ rpc });          // previous take's late release
    await vi.advanceTimersByTimeAsync(1_000); await acquiring;
    const next = currentTakeLeaseId(); expect(next).not.toBe(null);
    await vi.advanceTimersByTimeAsync(5_000); await lateRelease;
    expect(released).not.toContain(next); expect(currentTakeLeaseId()).toBe(next);
});

type Mode = 'online' | 'offline' | 'hang' | 'refuse' | 'slow-refuse';
function network() {
    const mode: { abandon: Mode; release: Mode; acquireMs: number } = { abandon: 'online', release: 'online', acquireMs: 0 };
    const calls: { fn: string; lease: unknown }[] = [];
    const rpc: LeaseRpc = (fn, args) => {
        // A failed Start's FIRST abandon is always offline (that is how a lease comes to be remembered); retries follow `mode`.
        const first = fn === 'abandon_recording_start_v1' && !calls.some((c) => c.fn === fn && c.lease === args.p_lease_id);
        calls.push({ fn, lease: args.p_lease_id });
        const m = first ? 'offline' : fn === 'abandon_recording_start_v1' ? mode.abandon : fn === 'release_recording_lease' ? mode.release : 'online';
        if (m === 'hang') return new Promise(() => {});
        if (m === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
        if (fn === 'acquire_recording_lease') {
            const answer = { data: { acquired: true, took_over: false }, error: null };
            return mode.acquireMs ? new Promise((r) => setTimeout(() => r(answer), mode.acquireMs)) : Promise.resolve(answer);
        }
        if (m === 'slow-refuse') return new Promise((r) => setTimeout(() => r({ data: { abandoned: false, reason: 'take_exists' }, error: null }), LEASE_SETTLE_RPC_DEADLINE_MS - 100));
        if (m === 'refuse') return Promise.resolve({ data: { abandoned: false, reason: 'take_exists' }, error: null });
        if (fn === 'abandon_recording_start_v1') return Promise.resolve({ data: { abandoned: true, outcome: 'abandoned_not_recorded', repeated: false }, error: null });
        return Promise.resolve({ data: { released: true }, error: null });
    };
    return { rpc, mode, of: (fn: string) => calls.filter((c) => c.fn === fn).map((c) => c.lease) };
}

/**
 * N failed offline Starts whose abandons never reached the server: N exact leases remembered. Retries of earlier ones hang
 * meanwhile (one pass at a time, so they cost at most one try), then the timers drain so every test starts from a quiet state.
 */
async function strand(net: ReturnType<typeof network>, n: number): Promise<string[]> {
    const leases = Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
    net.mode.abandon = 'hang';
    for (const cold of leases) {
        // Timers advance only if the release itself waits (it must not, but a regression must fail rather than hang).
        let done = false;
        const failed = releaseTakeLease({ rpc: net.rpc, startFailed: cold }).then(() => { done = true; });
        await vi.advanceTimersByTimeAsync(0);
        if (!done) await vi.advanceTimersByTimeAsync(LEASE_SETTLE_RPC_DEADLINE_MS * 3);
        await failed;
    }
    await vi.advanceTimersByTimeAsync(LEASE_SETTLE_RPC_DEADLINE_MS * 3);
    return leases;
}

/** How long a call takes under fake timers, in 100 ms steps, capped. */
async function elapsedMs(start: () => Promise<unknown>, capMs = 60_000): Promise<number> {
    let done = false; const t0 = Date.now();
    void start().then(() => { done = true; }, () => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    while (!done && Date.now() - t0 < capMs) await vi.advanceTimersByTimeAsync(100);
    return Date.now() - t0;
}

describe('P1: a release only ever touches the lease held when it was called', () => {
    it('a Stop of take A that overlaps take B\'s acquire never releases B (held lease captured before any await)', async () => {
        const net = network(); await strand(net, 3);
        await elapsedMs(() => acquireTakeLease({ rpc: net.rpc }));
        net.mode.abandon = 'hang'; net.mode.acquireMs = 1_000;
        const a = currentTakeLeaseId()!;
        const stopA = releaseTakeLease({ rpc: net.rpc });
        expect(currentTakeLeaseId(), 'cleared at the call, synchronously').toBeNull();
        const startB = acquireTakeLease({ rpc: net.rpc });
        await vi.advanceTimersByTimeAsync(10_000); await stopA; await startB;
        const b = currentTakeLeaseId();
        expect(b).not.toBeNull(); expect(b).not.toBe(a);
        expect(net.of('release_recording_lease')).toContain(a);
        expect(net.of('release_recording_lease')).not.toContain(b);
    });

    it('a failed-Start settle for an OLD lease never clears or releases the newer held lease', async () => {
        const net = network(); const [old] = await strand(net, 1);
        net.mode.abandon = 'hang';
        await elapsedMs(() => acquireTakeLease({ rpc: net.rpc }));
        const held = currentTakeLeaseId()!;
        await elapsedMs(() => releaseTakeLease({ rpc: net.rpc, startFailed: old }));
        expect(currentTakeLeaseId()).toBe(held);
        expect(net.of('release_recording_lease')).not.toContain(held);
        expect(net.of('abandon_recording_start_v1')).not.toContain(held);
    });
});

describe('P2: Start gets one total budget; Stop never waits on old retries', () => {
    it.each([1, 3, 5, MAX_ABANDONS_PER_PASS, MAX_ABANDONS_PER_PASS + 4])('%i hung remembered leases: Start waits one budget, Stop does not wait on them', async (n) => {
        const net = network(); const stranded = await strand(net, n);
        expect(__unreachedAbandonsForTests()).toHaveLength(n);
        net.mode.abandon = 'hang';
        const start = await elapsedMs(() => acquireTakeLease({ rpc: net.rpc }));
        expect(start, `Start with ${n} hung`).toBeLessThanOrEqual(LEASE_SETTLE_RPC_DEADLINE_MS + 100);
        expect(currentTakeLeaseId()).not.toBeNull();
        const stop = await elapsedMs(() => releaseTakeLease({ rpc: net.rpc }));
        expect(stop, `Stop with ${n} hung`).toBeLessThanOrEqual(100);
        // Unanswered is uncertain, never assumed settled: every exact lease is still remembered.
        expect(__unreachedAbandonsForTests().sort()).toEqual([...stranded].sort());
    });

    it('the budget is real: with 3 hung, Start is still waiting just before it and done at it', async () => {
        const net = network(); await strand(net, 3);
        net.mode.abandon = 'hang';
        let done = false; void acquireTakeLease({ rpc: net.rpc }).then(() => { done = true; });
        await vi.advanceTimersByTimeAsync(LEASE_SETTLE_RPC_DEADLINE_MS - 1);
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(done).toBe(true);
    });

    it('3 refused leases whose follow-up release hangs: Start still waits one budget, and each is released', async () => {
        const net = network(); const stranded = await strand(net, 3);
        net.mode.abandon = 'refuse'; net.mode.release = 'hang';
        const start = await elapsedMs(() => acquireTakeLease({ rpc: net.rpc }));
        expect(start).toBeLessThanOrEqual(LEASE_SETTLE_RPC_DEADLINE_MS + 100);
        expect(__unreachedAbandonsForTests(), 'a server answer ends the retry').toEqual([]);
        for (const lease of stranded) expect(net.of('release_recording_lease')).toContain(lease);
    });

    it('a pass longer than the budget (a late refusal, then a hung release) still costs Start only the one budget', async () => {
        const net = network(); const stranded = await strand(net, 3);
        net.mode.abandon = 'slow-refuse'; net.mode.release = 'hang';
        const start = await elapsedMs(() => acquireTakeLease({ rpc: net.rpc }));
        expect(start).toBeLessThanOrEqual(LEASE_SETTLE_RPC_DEADLINE_MS + 100);
        expect(currentTakeLeaseId()).not.toBeNull();
        await vi.advanceTimersByTimeAsync(LEASE_SETTLE_RPC_DEADLINE_MS * 2);
        for (const lease of stranded) expect(net.of('release_recording_lease')).toContain(lease);
    });

    it('once the server answers, every remembered lease settles in one pass, each abandoned exactly once more', async () => {
        const net = network(); const stranded = await strand(net, 3);
        net.mode.abandon = 'online';
        await elapsedMs(() => acquireTakeLease({ rpc: net.rpc }));
        expect(__unreachedAbandonsForTests()).toEqual([]);
        // Each: the first offline call, at most one hung retry while stranding, then the answered one.
        for (const lease of stranded) {
            const tries = net.of('abandon_recording_start_v1').filter((l) => l === lease).length;
            expect(tries).toBeGreaterThanOrEqual(2); expect(tries).toBeLessThanOrEqual(3);
        }
    });

    it('no uncertain lease is ever dropped: the ninth (and twelfth) failed Start keeps the first lease remembered', async () => {
        const net = network(); const stranded = await strand(net, MAX_ABANDONS_PER_PASS + 4);
        expect(__unreachedAbandonsForTests()).toEqual(stranded);
    });

    it('bounded work: one pass makes at most MAX_ABANDONS_PER_PASS calls, oldest first; the rest settle on the next pass', async () => {
        const net = network(); const stranded = await strand(net, MAX_ABANDONS_PER_PASS + 4);
        net.mode.abandon = 'online';
        const before = net.of('abandon_recording_start_v1').length;
        await elapsedMs(() => acquireTakeLease({ rpc: net.rpc }));
        expect(net.of('abandon_recording_start_v1').slice(before)).toEqual(stranded.slice(0, MAX_ABANDONS_PER_PASS));
        expect(__unreachedAbandonsForTests()).toEqual(stranded.slice(MAX_ABANDONS_PER_PASS));
        await elapsedMs(() => releaseTakeLease({ rpc: net.rpc }));
        await vi.advanceTimersByTimeAsync(0);
        expect(__unreachedAbandonsForTests()).toEqual([]);
        expect(net.of('abandon_recording_start_v1')).toContain(stranded[0]);
    });
});
