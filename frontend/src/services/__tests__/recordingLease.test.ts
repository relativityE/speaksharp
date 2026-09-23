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
