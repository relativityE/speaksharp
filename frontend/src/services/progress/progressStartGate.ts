/**
 * #1354 — the authority on whether a new recording may start.
 *
 * WHY THIS IS NOT JUST THE STORE. The store gate is a UI signal; it is per-tab, it can be stale, and a
 * second already-open tab never sees debt that another tab queued (browser `storage` events notify
 * OTHER tabs, never the writer). Enforcement therefore reads the VERIFIED durable queue on every real
 * Start attempt and never trusts the store for the decision.
 *
 * Fail-closed throughout: an unreadable or corrupt queue blocks, because "we could not tell" is not
 * "there is no debt".
 */
import { getQueuedSessionIdsForUser, PROGRESS_QUEUE_STORAGE_KEY as QUEUE_KEY } from './progressReconcileQueue';
import type { QueueFailure } from './progressReconcileQueue';

export type StartGateVerdict =
    | { allowed: true }
    | { allowed: false; reason: 'queued_debt'; sessionId: string }
    | { allowed: false; reason: 'queue_unreadable'; failure: QueueFailure }
    | { allowed: false; reason: 'in_flight'; sessionId: string }
    | { allowed: false; reason: 'unresolved_evidence'; sessionId: string };

/**
 * Decide from the DURABLE queue alone, for this exact owner.
 *
 * `ownerId` is required: debt belongs to an account, and another account's debt must never block the
 * current user. A missing owner means we cannot scope the question, so nothing is blocked here — the
 * in-flight store gate still applies, and a save without an owner already fails closed at the seam.
 */
export function evaluateDurableStartGate(ownerId: string | null | undefined): StartGateVerdict {
    if (!ownerId) return { allowed: true };
    const queued = getQueuedSessionIdsForUser(ownerId);
    if (!queued.ok) return { allowed: false, reason: 'queue_unreadable', failure: queued.failure };
    const first = (queued.sessionIds ?? [])[0];
    if (first) return { allowed: false, reason: 'queued_debt', sessionId: first };
    return { allowed: true };
}

/**
 * The full Start decision: durable debt first, then any IN-FLIGHT evaluation for this owner.
 *
 * The in-flight state cannot live in the queue — nothing is queued while an evaluation is still
 * resolving — so it is the one input taken from the store. It is still owner-checked: a `resolving`
 * gate left behind by a PREVIOUS account must not block the current one, and equally must not be
 * cleared by that account's late-arriving result.
 */
export function evaluateStartGate(
    ownerId: string | null | undefined,
    inFlight: { sessionId: string; ownerId: string | null; state: 'resolving' | 'queued' | 'unresolved' } | null,
): StartGateVerdict {
    const durable = evaluateDurableStartGate(ownerId);
    if (!durable.allowed) return durable;
    if (inFlight && inFlight.ownerId === (ownerId ?? null)) {
        // The gate's STATE must survive into the verdict: `resolving`, `queued` and `unresolved` are
        // three different situations for the user and get three different actionable messages.
        // Collapsing them to one reason lost that distinction.
        if (inFlight.state === 'queued') return { allowed: false, reason: 'queued_debt', sessionId: inFlight.sessionId };
        if (inFlight.state === 'unresolved') return { allowed: false, reason: 'unresolved_evidence', sessionId: inFlight.sessionId };
        return { allowed: false, reason: 'in_flight', sessionId: inFlight.sessionId };
    }
    return { allowed: true };
}

/** Content-free, actionable copy. Never names a session, an account, or an error body. */
export function startGateMessage(verdict: StartGateVerdict): string | null {
    if (verdict.allowed) return null;
    switch (verdict.reason) {
        case 'in_flight':
            return 'Finishing up your last session — one moment.';
        case 'queued_debt':
            return 'Finishing up your last session — this will retry automatically. You can start again once it completes.';
        case 'unresolved_evidence':
            return "We couldn't finish saving your last session's progress. Reload to retry before recording again.";
        case 'queue_unreadable':
            return "We couldn't confirm your last session was saved. Reload to retry before recording again.";
    }
}

/**
 * localStorage key the durable queue lives under — exported so the cross-tab listener can filter.
 * #1354: RE-EXPORTED from the queue module, which owns it. A second literal here would be a second
 * production authority for the same key, free to drift from the one the writer actually uses.
 */
export { PROGRESS_QUEUE_STORAGE_KEY } from './progressReconcileQueue';

export type GateState = { sessionId: string; ownerId: string | null; state: 'resolving' | 'queued' | 'unresolved' } | null;

/**
 * Rebuild the VISIBLE gate from the durable queue.
 *
 * Used on load (reload starts blocked until this has run and found nothing owed) and whenever another
 * tab changes the queue. It never invents an in-flight state — only durable debt is reconstructable,
 * because an in-flight evaluation belongs to the tab that started it.
 *
 * Returns the gate to publish; `null` means nothing is owed by this owner.
 */
export function reconstructGateFromQueue(ownerId: string | null | undefined): GateState {
    const verdict = evaluateDurableStartGate(ownerId);
    if (verdict.allowed) return null;
    if (verdict.reason === 'queued_debt') {
        return { sessionId: verdict.sessionId, ownerId: ownerId ?? null, state: 'queued' };
    }
    // Unreadable: we cannot name the session, but we must still show blocked.
    return { sessionId: '', ownerId: ownerId ?? null, state: 'unresolved' };
}

/**
 * Subscribe to CROSS-TAB queue changes.
 *
 * Browser `storage` events fire in OTHER tabs, never in the writer — so the writing tab updates its own
 * state directly (the controller already does, via the gate it publishes) and this exists purely so an
 * already-open second tab reacts. Controller enforcement never depends on this firing: Start re-reads
 * the durable queue every time regardless.
 */
export function subscribeCrossTabProgressGate(
    getOwnerId: () => string | null | undefined,
    publish: (gate: GateState) => void,
): () => void {
    if (typeof window === 'undefined') return () => {};
    const onStorage = (e: StorageEvent) => {
        // `key === null` is a whole-storage clear, which also invalidates our view.
        if (e.key !== null && e.key !== QUEUE_KEY) return;
        publish(reconstructGateFromQueue(getOwnerId()));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
}
