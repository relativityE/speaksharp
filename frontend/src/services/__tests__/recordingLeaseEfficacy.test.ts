/** #1843: assertions on admission and RPC activity, not just callback counts. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    __resetTakeLeaseForTests,
    acquireTakeLease,
    confirmTakeLease,
    currentTakeLeaseId,
    startLeaseHeartbeat,
    type LeaseRpc,
} from '../recordingLease';

beforeEach(() => { vi.useFakeTimers(); __resetTakeLeaseForTests(); });
afterEach(() => { __resetTakeLeaseForTests(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('lease efficacy: takeover and admission', () => {
    it('remote takeover cancels the timer and sends no further heartbeats', async () => {
        const rpc = vi.fn<LeaseRpc>(async (fn) => ({
            data: fn === 'acquire_recording_lease' ? { acquired: true } : { valid: false, reason: 'revoked' },
            error: null,
        }));
        await acquireTakeLease({ rpc });
        const lease = currentTakeLeaseId();
        const onRevoked = vi.fn();
        startLeaseHeartbeat(onRevoked, { rpc, intervalMs: 100 });
        await vi.advanceTimersByTimeAsync(100);
        expect(onRevoked).toHaveBeenCalledTimes(1);
        expect(currentTakeLeaseId()).toBeNull();
        expect(vi.getTimerCount(), 'revocation cancels the actual interval').toBe(0);
        await vi.advanceTimersByTimeAsync(1000);
        expect(rpc.mock.calls.filter(([fn]) => fn === 'heartbeat_recording_lease')).toEqual([
            ['heartbeat_recording_lease', { p_lease_id: lease }],
        ]);
    });

    it('an already queued callback for a locally replaced lease sends no stale heartbeat', async () => {
        const interval = vi.spyOn(globalThis, 'setInterval');
        const rpc = vi.fn<LeaseRpc>(async (fn) => ({
            data: fn === 'acquire_recording_lease' ? { acquired: true } : { valid: true, released: true },
            error: null,
        }));
        await acquireTakeLease({ rpc });
        const firstLease = currentTakeLeaseId();
        const onRevoked = vi.fn();
        startLeaseHeartbeat(onRevoked, { rpc, intervalMs: 100 });
        const queuedCallback = interval.mock.calls[0][0];
        expect(typeof queuedCallback).toBe('function');
        await acquireTakeLease({ rpc, force: true });
        const replacement = currentTakeLeaseId();
        expect(replacement).not.toBe(firstLease);
        // Simulate a callback already queued before clearInterval, after replacement.
        (queuedCallback as () => void)();
        await Promise.resolve();
        expect(rpc.mock.calls.filter(([fn]) => fn === 'heartbeat_recording_lease'), 'old callback must not contact the authority').toEqual([]);
        expect(currentTakeLeaseId()).toBe(replacement);
        expect(onRevoked).not.toHaveBeenCalled();
    });

    it('an RPC error wins over a valid-looking payload during final admission', async () => {
        const rpc = vi.fn<LeaseRpc>(async (fn) => fn === 'acquire_recording_lease'
            ? { data: { acquired: true }, error: null }
            : { data: { valid: true }, error: { message: 'authority unavailable' } });
        await acquireTakeLease({ rpc });
        const lease = currentTakeLeaseId();
        await expect(confirmTakeLease({ rpc }), 'errored response cannot authorize engine work').resolves.toBe('unconfirmed');
        expect(rpc).toHaveBeenLastCalledWith('heartbeat_recording_lease', { p_lease_id: lease });
        expect(currentTakeLeaseId(), 'unconfirmed is not revoked').toBe(lease);
    });
});
