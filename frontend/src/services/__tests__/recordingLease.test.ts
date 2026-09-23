/**
 * #1476 — ONE ACCOUNT, ONE AUTHORIZED ENGINE: the client side of the account-keyed recording lease.
 *
 * The server fences what a client cannot (tests/db/one-active-engine-1476.integration.test.ts). This module is what
 * makes a CURRENT client take part: acquire before engine preparation, heartbeat through the take, stop when
 * displaced, release on Stop, and carry the lease into session creation. The RPC is injected, so these run against the
 * exact request/response contract with no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    acquireTakeLease,
    confirmTakeLease,
    currentTakeLeaseId,
    releaseTakeLease,
    startLeaseHeartbeat,
    __resetTakeLeaseForTests,
    type LeaseRpc,
} from '../recordingLease';

type Call = { fn: string; args: Record<string, unknown> };

function fakeRpc(responses: Partial<Record<string, (args: Record<string, unknown>) => unknown>>) {
    const calls: Call[] = [];
    const rpc: LeaseRpc = async (fn, args) => {
        calls.push({ fn, args });
        const handler = responses[fn];
        if (!handler) return { data: null, error: { message: `no handler for ${fn}` } };
        try { return { data: handler(args), error: null }; } catch (e) { return { data: null, error: { message: String(e) } }; }
    };
    return { rpc, calls };
}

beforeEach(() => { __resetTakeLeaseForTests(); vi.useFakeTimers(); });
afterEach(() => { __resetTakeLeaseForTests(); vi.useRealTimers(); });

describe('#1476 acquire — before engine preparation', () => {
    it('a free lease starts the take and becomes the lease session creation carries', async () => {
        const { rpc, calls } = fakeRpc({ acquire_recording_lease: () => ({ acquired: true, took_over: false }) });
        const d = await acquireTakeLease({ rpc });
        expect(d.action).toBe('start');
        expect(calls[0]).toMatchObject({ fn: 'acquire_recording_lease', args: { p_force: false } });
        expect(currentTakeLeaseId()).toBe(calls[0].args.p_lease_id);
        expect(String(currentTakeLeaseId())).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('CASUALTY: a live take on another device BLOCKS with truthful copy, and holds no lease here', async () => {
        const { rpc } = fakeRpc({ acquire_recording_lease: () => ({ acquired: false, reason: 'held_by_other', holder_label: 'this browser on MacIntel' }) });
        const d = await acquireTakeLease({ rpc });
        expect(d).toMatchObject({ action: 'blocked', holderLabel: 'this browser on MacIntel' });
        expect(d.action === 'blocked' && d.message).toBe('A recording is active on this browser on MacIntel. Stop it there, or press Start again to take over here — that stops the recording there, and what it recorded so far is saved.');
        expect(currentTakeLeaseId()).toBeNull();
    });

    it('an explicit takeover forces the lease', async () => {
        const { rpc, calls } = fakeRpc({ acquire_recording_lease: () => ({ acquired: true, took_over: true }) });
        expect(await acquireTakeLease({ rpc, force: true })).toEqual({ action: 'start', tookOver: true });
        expect(calls[0].args.p_force).toBe(true);
    });

    it('CASUALTY: an unavailable lease authority FAILS CLOSED — no Start, no lease', async () => {
        const { rpc } = fakeRpc({}); // every call errors
        const d = await acquireTakeLease({ rpc });
        expect(d.action).toBe('error');
        expect(currentTakeLeaseId()).toBeNull();
    });

    it('CASUALTY: a new take first releases the lease this device still holds, so it never blocks itself', async () => {
        const { rpc, calls } = fakeRpc({
            acquire_recording_lease: () => ({ acquired: true }),
            release_recording_lease: () => ({ released: true }),
        });
        await acquireTakeLease({ rpc });
        const first = currentTakeLeaseId();
        await acquireTakeLease({ rpc });
        expect(calls.map((c) => c.fn)).toEqual(['acquire_recording_lease', 'release_recording_lease', 'acquire_recording_lease']);
        expect(calls[1].args.p_lease_id).toBe(first);
        expect(currentTakeLeaseId()).not.toBe(first);
    });
});

describe('#1476 heartbeat — the displaced holder stops', () => {
    it('CASUALTY: when the server says the lease is revoked, the take is stopped and the lease dropped', async () => {
        let valid = true;
        const { rpc } = fakeRpc({
            acquire_recording_lease: () => ({ acquired: true }),
            heartbeat_recording_lease: () => (valid ? { valid: true } : { valid: false, reason: 'revoked' }),
        });
        await acquireTakeLease({ rpc });
        const onRevoked = vi.fn();
        startLeaseHeartbeat(onRevoked, { rpc, intervalMs: 5000 });
        await vi.advanceTimersByTimeAsync(5000);
        expect(onRevoked).not.toHaveBeenCalled();
        valid = false;
        await vi.advanceTimersByTimeAsync(5000);
        expect(onRevoked).toHaveBeenCalledTimes(1);
        expect(currentTakeLeaseId()).toBeNull();
        await vi.advanceTimersByTimeAsync(20000);
        expect(onRevoked, 'the heartbeat stops after revocation').toHaveBeenCalledTimes(1);
    });

    it('CONTROL: a transient network failure is NOT a revocation — an in-progress take is not interrupted', async () => {
        const { rpc } = fakeRpc({ acquire_recording_lease: () => ({ acquired: true }) }); // heartbeat errors
        await acquireTakeLease({ rpc });
        const onRevoked = vi.fn();
        startLeaseHeartbeat(onRevoked, { rpc, intervalMs: 5000 });
        await vi.advanceTimersByTimeAsync(15000);
        expect(onRevoked).not.toHaveBeenCalled();
        expect(currentTakeLeaseId()).not.toBeNull();
    });
});

describe('#1476 release — Stop ends the take normally', () => {
    it('releases the held lease once, stops the heartbeat, and is idempotent', async () => {
        const { rpc, calls } = fakeRpc({
            acquire_recording_lease: () => ({ acquired: true }),
            heartbeat_recording_lease: () => ({ valid: true }),
            release_recording_lease: () => ({ released: true }),
        });
        await acquireTakeLease({ rpc });
        const lease = currentTakeLeaseId();
        startLeaseHeartbeat(vi.fn(), { rpc, intervalMs: 5000 });
        await releaseTakeLease({ rpc });
        await releaseTakeLease({ rpc });
        expect(calls.filter((c) => c.fn === 'release_recording_lease')).toEqual([{ fn: 'release_recording_lease', args: { p_lease_id: lease } }]);
        const beats = calls.filter((c) => c.fn === 'heartbeat_recording_lease').length;
        await vi.advanceTimersByTimeAsync(20000);
        expect(calls.filter((c) => c.fn === 'heartbeat_recording_lease').length, 'no heartbeat after release').toBe(beats);
        expect(currentTakeLeaseId()).toBeNull();
    });
});

describe('#1476 PM RETURN on 040da46a / 54576db9 — admission revalidates ownership and FAILS CLOSED', () => {
    it('CASUALTY: the server now says the lease is another device\'s — revoked, and the lease is dropped', async () => {
        const { rpc, calls } = fakeRpc({
            acquire_recording_lease: () => ({ acquired: true }),
            heartbeat_recording_lease: () => ({ valid: false, reason: 'revoked' }),
        });
        await acquireTakeLease({ rpc });
        const lease = currentTakeLeaseId();
        await expect(confirmTakeLease({ rpc })).resolves.toBe('revoked');
        expect(calls[calls.length - 1]).toEqual({ fn: 'heartbeat_recording_lease', args: { p_lease_id: lease } });
        expect(currentTakeLeaseId()).toBeNull();
        await expect(confirmTakeLease({ rpc }), 'stays revoked until the next acquire').resolves.toBe('revoked');
    });

    it('CASUALTY: a revocation the heartbeat already saw is final — no second server round trip needed', async () => {
        const { rpc, calls } = fakeRpc({
            acquire_recording_lease: () => ({ acquired: true }),
            heartbeat_recording_lease: () => ({ valid: false, reason: 'revoked' }),
        });
        await acquireTakeLease({ rpc });
        startLeaseHeartbeat(vi.fn(), { rpc, intervalMs: 5000 });
        await vi.advanceTimersByTimeAsync(5000);
        const beats = calls.length;
        await expect(confirmTakeLease({ rpc })).resolves.toBe('revoked');
        expect(calls.length).toBe(beats);
    });

    it('CONTROL: a lease the server confirms as still ours is held', async () => {
        const { rpc } = fakeRpc({
            acquire_recording_lease: () => ({ acquired: true }),
            heartbeat_recording_lease: () => ({ valid: true }),
        });
        await acquireTakeLease({ rpc });
        await expect(confirmTakeLease({ rpc })).resolves.toBe('held');
    });

    it('CASUALTY (PM RETURN on 54576db9): a server ERROR is not a confirmation — unconfirmed, never held', async () => {
        const { rpc } = fakeRpc({ acquire_recording_lease: () => ({ acquired: true }) }); // heartbeat → error response
        await acquireTakeLease({ rpc });
        await expect(confirmTakeLease({ rpc })).resolves.toBe('unconfirmed');
        expect(currentTakeLeaseId(), 'a transient failure is not a revocation: the lease is not dropped here').not.toBeNull();
    });

    it('CASUALTY (PM RETURN on 54576db9): a THROWN request is not a confirmation either', async () => {
        const { rpc: base } = fakeRpc({ acquire_recording_lease: () => ({ acquired: true }) });
        const rpc: LeaseRpc = async (fn, args) => { if (fn === 'heartbeat_recording_lease') throw new Error('offline'); return base(fn, args); };
        await acquireTakeLease({ rpc });
        await expect(confirmTakeLease({ rpc })).resolves.toBe('unconfirmed');
    });

    it('CASUALTY (PM RETURN on 54576db9): an answer that does not affirm the lease is unconfirmed', async () => {
        const { rpc } = fakeRpc({ acquire_recording_lease: () => ({ acquired: true }), heartbeat_recording_lease: () => null });
        await acquireTakeLease({ rpc });
        await expect(confirmTakeLease({ rpc })).resolves.toBe('unconfirmed');
    });

    it('CASUALTY (PM pre-push review): a revocation during an in-flight confirmation wins over the stale valid:true', async () => {
        let answer: (v: { data: unknown; error: unknown }) => void = () => undefined;
        let beats = 0;
        const rpc: LeaseRpc = async (fn) => {
            if (fn === 'acquire_recording_lease') return { data: { acquired: true }, error: null };
            beats += 1;
            if (beats === 1) return new Promise((resolve) => { answer = resolve; });
            return { data: { valid: false, reason: 'revoked' }, error: null };
        };
        await acquireTakeLease({ rpc });
        const confirmation = confirmTakeLease({ rpc });
        const onRevoked = vi.fn();
        startLeaseHeartbeat(onRevoked, { rpc, intervalMs: 5000 });
        await vi.advanceTimersByTimeAsync(5000);
        expect(onRevoked).toHaveBeenCalledTimes(1);
        answer({ data: { valid: true }, error: null });
        await expect(confirmation).resolves.toBe('revoked');
    });

    it('CASUALTY (PM pre-push review): a lease replaced while the confirmation was in flight is not "held"', async () => {
        let answer: (v: { data: unknown; error: unknown }) => void = () => undefined;
        const rpc: LeaseRpc = async (fn) => {
            if (fn === 'heartbeat_recording_lease') return new Promise((resolve) => { answer = resolve; });
            return { data: fn === 'acquire_recording_lease' ? { acquired: true } : { released: true }, error: null };
        };
        await acquireTakeLease({ rpc });
        const confirmation = confirmTakeLease({ rpc });
        await releaseTakeLease({ rpc }); // Stop, or a new take, while the answer is pending
        answer({ data: { valid: true }, error: null });
        await expect(confirmation, 'not held — and not blamed on another device').resolves.toBe('unconfirmed');
    });

    it('CASUALTY (PM pre-push RETURN 2): a delayed INVALID answer for lease A does not revoke lease B acquired meanwhile', async () => {
        let answerA: (v: { data: unknown; error: unknown }) => void = () => undefined;
        let heartbeats = 0;
        const rpc: LeaseRpc = async (fn) => {
            if (fn === 'acquire_recording_lease') return { data: { acquired: true }, error: null };
            if (fn === 'release_recording_lease') return { data: { released: true }, error: null };
            heartbeats += 1;
            if (heartbeats === 1) return new Promise((resolve) => { answerA = resolve; }); // A's confirmation: delayed
            return { data: { valid: true }, error: null };                                  // B is live
        };
        await acquireTakeLease({ rpc });
        const leaseA = currentTakeLeaseId();
        const confirmationA = confirmTakeLease({ rpc });
        await acquireTakeLease({ rpc }); // a new take: A released, B held
        const leaseB = currentTakeLeaseId();
        expect(leaseB).not.toBe(leaseA);

        answerA({ data: { valid: false, reason: 'revoked' }, error: null }); // A's stale verdict lands after B exists
        await expect(confirmationA, 'an answer about A is not a verdict on B').resolves.toBe('unconfirmed');
        expect(currentTakeLeaseId(), 'B is still held').toBe(leaseB);
        await expect(confirmTakeLease({ rpc }), 'B confirms as held').resolves.toBe('held');
    });

    it('CONTROL: no lease held (a server without the lease functions) has nothing to revalidate', async () => {
        const { rpc, calls } = fakeRpc({});
        await expect(confirmTakeLease({ rpc })).resolves.toBe('held');
        expect(calls).toEqual([]);
    });

    it('a new acquire clears an earlier revocation', async () => {
        let valid = false;
        const { rpc } = fakeRpc({
            acquire_recording_lease: () => ({ acquired: true }),
            heartbeat_recording_lease: () => ({ valid }),
        });
        await acquireTakeLease({ rpc });
        await expect(confirmTakeLease({ rpc })).resolves.toBe('revoked');
        valid = true;
        await acquireTakeLease({ rpc });
        await expect(confirmTakeLease({ rpc })).resolves.toBe('held');
    });
});
