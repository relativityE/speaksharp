/**
 * #1259 — WHICH LOAD DOES THIS RECEIPT DESCRIBE?
 *
 * The worker's acquisition receipt arrived with no identity on it. The engine stored whatever showed
 * up, so a receipt from a superseded attempt — a candidate switch, a retry after a failure, a torn-down
 * worker answering late — would be accepted and attributed to whatever load happened to be current.
 * That is worse than missing telemetry: the numbers still look like measurements, and model selection
 * is exactly the decision they would corrupt. A download time recorded against the wrong candidate is
 * an argument for shipping the wrong model.
 *
 * So every acquisition mints a token, the token and the frozen candidate identity travel into the
 * worker, and the receipt must echo both. A receipt that does not match the CURRENTLY ACTIVE attempt is
 * ignored — silently as far as readiness is concerned, because a late receipt is a telemetry event, not
 * a model failure.
 */
import type { AcquisitionNetworkObservation } from './acquisitionNetworkObservation';

export interface AcquisitionAttempt {
    /** Unique per acquisition. Not derived from the candidate: two loads of the same candidate differ. */
    token: string;
    /** The candidate identity FROZEN at mint time, before anything is fetched. */
    candidateId: string;
}

/** The worker's observation, plus the identity of the attempt it belongs to. */
export interface AcquisitionReceipt extends AcquisitionNetworkObservation {
    attemptToken: string;
    candidateId: string;
}

let counter = 0;

/**
 * Mint a token for one acquisition.
 *
 * `crypto.randomUUID` where available; a counter-plus-time fallback otherwise. Uniqueness is all that
 * is required — the token is never persisted, never sent to analytics, and identifies nothing but an
 * in-flight load within this tab.
 */
export function mintAcquisitionAttempt(candidateId: string): AcquisitionAttempt {
    counter += 1;
    const rand = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return { token: `acq-${counter}-${rand}`, candidateId };
}

/**
 * Does this receipt belong to the attempt currently in flight?
 *
 * BOTH must match. The token alone would admit a receipt whose candidate changed under it, and the
 * candidate alone would admit a previous attempt at the SAME candidate — which is precisely the retry
 * case, where the stale receipt describes the load that failed rather than the one that succeeded.
 */
export function receiptMatches(
    receipt: AcquisitionReceipt | null | undefined,
    attempt: AcquisitionAttempt | null | undefined,
): boolean {
    if (!receipt || !attempt) return false;
    return receipt.attemptToken === attempt.token && receipt.candidateId === attempt.candidateId;
}
