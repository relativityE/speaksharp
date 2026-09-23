/**
 * ACCOUNT-REC-LEASE — pure client-side interpretation of the server recording-lease RPCs.
 *
 * The DB (acquire/heartbeat/release_recording_lease) is the AUTHORITY; this module just turns its
 * results into a client action + friendly copy, so the controller/UX logic is unit-testable and the
 * messaging never leaks raw ids. Decisions (locked with product): one active recording per account;
 * a live other device BLOCKS by default and the user may explicitly take over.
 */

export interface AcquireLeaseResult {
    acquired?: boolean;
    reason?: string;
    holder_label?: string | null;
    started_at?: string | null;
    took_over?: boolean;
}

export type LeaseDecision =
    | { action: 'start'; tookOver: boolean }
    | { action: 'blocked'; holderLabel: string; startedAt: string | null; message: string }
    | { action: 'error'; reason: string; message: string };

/** Interpret an `acquire_recording_lease` RPC result into a client action + user-facing copy. */
export function interpretAcquireResult(result: AcquireLeaseResult | null | undefined): LeaseDecision {
    if (!result) {
        return { action: 'error', reason: 'no_response', message: 'Could not check your other devices. Please try again.' };
    }
    if (result.acquired) {
        return { action: 'start', tookOver: Boolean(result.took_over) };
    }
    if (result.reason === 'held_by_other') {
        const holderLabel = (result.holder_label && result.holder_label.trim()) || 'another device';
        return {
            action: 'blocked',
            holderLabel,
            startedAt: result.started_at ?? null,
            // Friendly, no raw ids; offers the take-over path. Default action (no choice) = stay blocked.
            // #1476: a second Start while this notice shows is the explicit take-over (no hidden default).
            // PM directive on dae853fb: B sees the consequence BEFORE choosing the take-over.
            message: `A recording is active on ${holderLabel}. Stop it there, or press Start again to take over here — that stops the recording there, and what it recorded so far is saved.`,
        };
    }
    if (result.reason === 'unauthenticated') {
        return { action: 'error', reason: 'unauthenticated', message: 'Please sign in again to start recording.' };
    }
    return { action: 'error', reason: result.reason ?? 'unknown', message: 'Could not start recording. Please try again.' };
}

export interface HeartbeatLeaseResult {
    valid?: boolean;
    reason?: string;
}

/**
 * True when the lease is no longer ours (another device took over, or it was released) — the caller
 * must stop recording. A network error (undefined) is NOT treated as revoked; transient failures
 * should not interrupt an in-progress recording.
 */
export function isLeaseRevoked(result: HeartbeatLeaseResult | null | undefined): boolean {
    return result != null && result.valid === false;
}

/** A short, non-sensitive device label for the lease holder (no auth/PII). */
export function buildHolderLabel(platform?: string): string {
    const p = (platform ?? (typeof navigator !== 'undefined' ? navigator.platform : '') ?? '').trim();
    return p ? `this browser on ${p}` : 'this browser';
}

/**
 * #1476: the server refused this take's session because another device holds the account's lease (it took over
 * between this device's acquire and its create). Starts with "Recording could not start" so the controller surfaces it.
 */
export const LEASE_NOT_HELD_MESSAGE =
    'Recording could not start: another device is recording on this account. Press Start again to take over here.';

/** #1476: this device's take was displaced — another device took over the account's one engine. */
export const LEASE_REVOKED_MESSAGE =
    'This recording stopped because another device took over. What was recorded here is being saved.';
