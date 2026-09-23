/**
 * #1476 — ONE ACCOUNT MAY ONLY RUN ONE STT ENGINE AT A TIME, across tabs and devices (PO rule).
 *
 * The client side of the account-keyed recording lease. The SERVER is the authority and fences what a client cannot —
 * another device, an old bundle, a displaced holder (migration 20260923120000_one_active_engine_per_account_1476).
 * This module is how a current client takes part:
 *  - acquire BEFORE engine preparation (one lease id per take), failing CLOSED when the authority cannot answer;
 *  - heartbeat through preparation and recording; a server `valid:false` means another device took over, so the take
 *    must stop — a transient network failure is NOT that, and never interrupts a recording;
 *  - release on Stop. Releasing is what marks the take as ended normally, so its save (or Retry Save) is still
 *    accepted after another device starts;
 *  - `currentTakeLeaseId()` is what session creation sends as `p_session_data.lease_id`.
 * A device never blocks itself: acquiring a new take first releases any lease this device still holds.
 */
import { getSupabaseClient } from '@/lib/supabaseClient';
import { buildHolderLabel, interpretAcquireResult, isLeaseRevoked, type AcquireLeaseResult, type LeaseDecision } from './recordingLeasePolicy';

export type LeaseRpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

const defaultRpc: LeaseRpc = async (fn, args) => {
    const { data, error } = await getSupabaseClient().rpc(fn, args);
    return { data, error };
};

const HEARTBEAT_INTERVAL_MS = 5000;

let heldLeaseId: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

const newLeaseId = (): string =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

function stopHeartbeat(): void {
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
}

/** The lease the current take holds, if any — sent with session creation. */
export function currentTakeLeaseId(): string | null {
    return heldLeaseId;
}

/** Acquire the account's lease for a NEW take. Never throws; an unanswerable authority is `action: 'error'`. */
export async function acquireTakeLease(opts: { force?: boolean; rpc?: LeaseRpc; holderLabel?: string } = {}): Promise<LeaseDecision> {
    const rpc = opts.rpc ?? defaultRpc;
    if (heldLeaseId !== null) await releaseTakeLease({ rpc });

    const leaseId = newLeaseId();
    let result: AcquireLeaseResult | null = null;
    try {
        const { data, error } = await rpc('acquire_recording_lease', {
            p_lease_id: leaseId,
            p_holder_label: opts.holderLabel ?? buildHolderLabel(),
            p_force: opts.force === true,
        });
        // A server with NO lease functions (PostgREST PGRST202) has no fence to take part in: that is a CAPABILITY GAP,
        // not an unanswerable authority. Recording proceeds exactly as it did before #1476, holding no lease. An outage
        // or any other error still fails closed below.
        if ((error as { code?: string } | null)?.code === 'PGRST202') return { action: 'start', tookOver: false };
        result = error ? null : (data as AcquireLeaseResult | null);
    } catch {
        result = null;
    }
    const decision = interpretAcquireResult(result);
    if (decision.action === 'start') heldLeaseId = leaseId;
    return decision;
}

/**
 * Heartbeat the held lease. `onRevoked` runs once when the server reports the lease is no longer ours (another device
 * took over): the caller must stop the take. Network errors are ignored.
 */
export function startLeaseHeartbeat(onRevoked: () => void, opts: { rpc?: LeaseRpc; intervalMs?: number } = {}): void {
    const rpc = opts.rpc ?? defaultRpc;
    stopHeartbeat();
    if (heldLeaseId === null) return;
    const leaseId = heldLeaseId;
    heartbeatTimer = setInterval(() => {
        void (async () => {
            if (heldLeaseId !== leaseId) { stopHeartbeat(); return; }
            let result: unknown = null;
            try {
                const { data, error } = await rpc('heartbeat_recording_lease', { p_lease_id: leaseId });
                result = error ? null : data;
            } catch {
                result = null;
            }
            if (heldLeaseId !== leaseId) return;
            if (isLeaseRevoked(result as { valid?: boolean } | null)) {
                stopHeartbeat();
                heldLeaseId = null;
                onRevoked();
            }
        })();
    }, opts.intervalMs ?? HEARTBEAT_INTERVAL_MS);
}

/** Release the held lease (Stop, a refused/failed Start, sign-out). Idempotent; never throws. */
export async function releaseTakeLease(opts: { rpc?: LeaseRpc } = {}): Promise<void> {
    const rpc = opts.rpc ?? defaultRpc;
    stopHeartbeat();
    const leaseId = heldLeaseId;
    heldLeaseId = null;
    if (leaseId === null) return;
    try {
        await rpc('release_recording_lease', { p_lease_id: leaseId });
    } catch {
        // The server expires an unreleased lease after 15 s without heartbeats; nothing else to do here.
    }
}

/** Test seam: forget any held lease and timer without calling the server. */
export function __resetTakeLeaseForTests(): void {
    stopHeartbeat();
    heldLeaseId = null;
}
