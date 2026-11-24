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
    await retryUnreachedAbandons();
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
 *
 * J7.c run 45364395660: a Start that fails because the browser went offline cannot reach the server either, and the
 * one call was lost, leaving the admitted obligation open. If the abandon call itself is unreached (a thrown or
 * transport error, no answer from the server), the exact lease is kept and the same call is retried when the browser
 * comes back online (`window` `online`), and again before the next release or acquire. Only the server's own answer
 * ends the retry: `abandoned`, or a definite refusal (a take exists, an unknown identity, another account), after which
 * the ordinary release runs as before. The server still proves no take exists; nothing here is a weaker settle.
 */
export async function releaseTakeLease(opts: { rpc?: LeaseRpc; startFailed?: string } = {}): Promise<void> {
    const rpc = opts.rpc ?? defaultRpc;
    await retryUnreachedAbandons();
    if (opts.startFailed !== undefined) {
        const leaseId = opts.startFailed;
        if (heldLeaseId === leaseId) {
            stopHeartbeat();
            heldLeaseId = null;
        }
        const outcome = await abandonStart(rpc, leaseId);
        if (outcome === 'abandoned') return;
        if (outcome === 'unreached') rememberUnreachedAbandon(leaseId, rpc);
        await releaseLease(rpc, leaseId);
        return;
    }
    stopHeartbeat();
    const leaseId = heldLeaseId;
    heldLeaseId = null;
    if (leaseId === null) return;
    await releaseLease(rpc, leaseId);
}

/**
 * J7.c (Sam's review 1795522438, finding 2): every settle call — the abandon and the release that follows a refusal or an
 * unreached abandon — waits at most this long. Acquire and release await the shared retry pass, so one hung call must
 * never hold a Start or a Stop. A call that runs out of time is treated as unreached: the exact lease stays remembered
 * for the next retry (its answer is uncertain, never assumed), and the server still expires an unreleased lease after
 * 15 s without heartbeats. The call itself is not cancelled; only the wait for it ends.
 */
export const LEASE_SETTLE_RPC_DEADLINE_MS = 4_000;

const TIMED_OUT = Symbol('lease-settle-timed-out');

/** Resolve with the call's answer, or `TIMED_OUT` after the deadline. A thrown call still throws. */
function withinDeadline<T>(call: Promise<T>): Promise<T | typeof TIMED_OUT> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), LEASE_SETTLE_RPC_DEADLINE_MS); });
    return Promise.race([call, deadline]).finally(() => clearTimeout(timer));
}

async function releaseLease(rpc: LeaseRpc, leaseId: string): Promise<void> {
    try {
        await withinDeadline(rpc('release_recording_lease', { p_lease_id: leaseId }));
    } catch {
        // The server expires an unreleased lease after 15 s without heartbeats; nothing else to do here.
    }
}

type AbandonOutcome = 'abandoned' | 'refused' | 'unreached';

/**
 * One abandon call, bounded by `LEASE_SETTLE_RPC_DEADLINE_MS`. `refused` only when the server itself answered without
 * abandoning; anything else, a call that ran out of time included, is `unreached`.
 */
async function abandonStart(rpc: LeaseRpc, leaseId: string): Promise<AbandonOutcome> {
    try {
        const answered = await withinDeadline(rpc('abandon_recording_start_v1', { p_lease_id: leaseId }));
        if (answered === TIMED_OUT) return 'unreached';
        const { data, error } = answered;
        if (error) return 'unreached';
        const answer = data as { abandoned?: unknown; reason?: unknown } | null;
        if (answer?.abandoned === true) return 'abandoned';
        return answer?.abandoned === false && typeof answer.reason === 'string' ? 'refused' : 'unreached';
    } catch {
        return 'unreached';
    }
}

/**
 * Failed Starts whose abandon never reached the server, by exact lease, with the rpc that should settle them and the
 * retries left. Bounded, so a server that never answers (an old one without the function) costs a few calls, not one per
 * release forever; the obligation then stays for the existing cleanup, exactly as before this retry existed.
 */
const ABANDON_RETRIES = 5;
const unreachedAbandons = new Map<string, { rpc: LeaseRpc; left: number }>();
let retrying: Promise<void> | null = null;
let onlineListening = false;

function rememberUnreachedAbandon(leaseId: string, rpc: LeaseRpc): void {
    unreachedAbandons.set(leaseId, { rpc, left: ABANDON_RETRIES });
    if (!onlineListening && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('online', onOnline);
        onlineListening = true;
    }
}

function onOnline(): void {
    void retryUnreachedAbandons();
}

/** Retry each unreached abandon once; keep only those still unreached. Never throws; one retry pass at a time. */
export function retryUnreachedAbandons(): Promise<void> {
    if (unreachedAbandons.size === 0) return Promise.resolve();
    retrying ??= (async () => {
        try {
            for (const [leaseId, entry] of [...unreachedAbandons]) {
                const { rpc } = entry;
                const outcome = await abandonStart(rpc, leaseId);
                if (outcome === 'unreached') {
                    entry.left -= 1;
                    if (entry.left <= 0) unreachedAbandons.delete(leaseId);
                    continue;
                }
                unreachedAbandons.delete(leaseId);
                if (outcome === 'refused') await releaseLease(rpc, leaseId);
            }
        } finally {
            retrying = null;
        }
    })();
    return retrying;
}

/** Test seam: the exact leases still waiting for an abandon the server never received. */
export function __unreachedAbandonsForTests(): string[] {
    return [...unreachedAbandons.keys()];
}

/** Test seam: forget any held lease and timer without calling the server. */
export function __resetTakeLeaseForTests(): void {
    stopHeartbeat();
    heldLeaseId = null;
    revoked = false;
    unreachedAbandons.clear();
    retrying = null;
    if (onlineListening && typeof window !== 'undefined') window.removeEventListener('online', onOnline);
    onlineListening = false;
}
