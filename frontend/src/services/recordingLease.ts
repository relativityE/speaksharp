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
 *  - #1643: a Start that ended before it recorded anything settles its lease as ABANDONED instead (`startFailed`), so
 *    the server's admitted save obligation for that lease does not stay open forever;
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
/** Set when the server reports this device's take lease is no longer its own; cleared by the next acquire. */
let revoked = false;

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
    revoked = false;

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
                revoked = true;
                onRevoked();
            }
        })();
    }, opts.intervalMs ?? HEARTBEAT_INTERVAL_MS);
}

/** The answer to "may this device begin engine work now?" — only `held` admits it. */
export type TakeLeaseConfirmation = 'held' | 'revoked' | 'unconfirmed';

/**
 * #1476 PM RETURN on 040da46a — REVALIDATE BEFORE ENGINE WORK. Called immediately before model preparation and before
 * the controller resumes a held Start after a download.
 * PM RETURN on 54576db9 — ADMISSION FAILS CLOSED. A running take tolerates a transient heartbeat failure; a Start waiting
 * for final authority does not: a server error or a throw is `unconfirmed`, never `held`. No lease held at all (a server
 * without the lease functions — the reported capability gap) has nothing to revalidate and stays `held`.
 */
export async function confirmTakeLease(opts: { rpc?: LeaseRpc } = {}): Promise<TakeLeaseConfirmation> {
    if (revoked) return 'revoked';
    const leaseId = heldLeaseId;
    if (leaseId === null) return 'held';
    const rpc = opts.rpc ?? defaultRpc;
    let data: unknown;
    try {
        const res = await rpc('heartbeat_recording_lease', { p_lease_id: leaseId });
        if (res.error) return 'unconfirmed';
        data = res.data;
    } catch {
        return 'unconfirmed';
    }
    // PM pre-push reviews: the answer is only as fresh as the request, and only about the lease it asked about.
    //  - A periodic heartbeat reported THIS lease revoked while the request was in flight → `revoked`.
    //  - The lease is no longer held (this device released it, or acquired a new take B) → the answer is about a lease
    //    this device no longer holds: `unconfirmed`, and it must NOT touch lease state — a stale invalid answer for A
    //    would otherwise mark B revoked.
    if (heldLeaseId !== leaseId) return revoked ? 'revoked' : 'unconfirmed';
    if (isLeaseRevoked(data as { valid?: boolean } | null)) {
        stopHeartbeat();
        heldLeaseId = null;
        revoked = true;
        return 'revoked';
    }
    return (data as { valid?: boolean } | null)?.valid === true ? 'held' : 'unconfirmed';
}

/**
 * Release the held lease (Stop, a refused/failed Start, sign-out). Idempotent; never throws.
 *
 * #1643 missing-Start (Sam, 2026-11-12): acquiring a lease opens an admitted save obligation on the server, and a plain
 * release never settles it. Pass `startFailed` with the exact lease a Start acquired when that Start failed or was
 * cancelled without recording: the server then settles that identity as abandoned and not recorded, and fences it for
 * good, but only after proving no take exists for it. A refusal (a take exists), an error, or a server without the
 * function falls back to the ordinary release of that same lease, so this is never weaker than releasing. Only that
 * lease is touched: a newer take's lease is never cleared here.
 */
export async function releaseTakeLease(opts: { rpc?: LeaseRpc; startFailed?: string } = {}): Promise<void> {
    const rpc = opts.rpc ?? defaultRpc;
    if (opts.startFailed !== undefined) {
        const leaseId = opts.startFailed;
        if (heldLeaseId === leaseId) {
            stopHeartbeat();
            heldLeaseId = null;
        }
        try {
            const { data, error } = await rpc('abandon_recording_start_v1', { p_lease_id: leaseId });
            if (!error && (data as { abandoned?: unknown } | null)?.abandoned === true) return;
        } catch {
            // Fall through to the ordinary release.
        }
        try {
            await rpc('release_recording_lease', { p_lease_id: leaseId });
        } catch {
            // The server expires an unreleased lease after 15 s without heartbeats.
        }
        return;
    }
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
    revoked = false;
}
