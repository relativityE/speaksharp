import { useEffect, useRef } from 'react';
import { useAuthProvider } from '../contexts/AuthProvider';
import { usePracticeHistory } from './usePracticeHistory';
import { reconcileProgressEvaluations, type ReconcilableSession } from '../services/progress/recordProgress';
import { reconstructGateFromQueue, subscribeCrossTabProgressGate } from '../services/progress/progressStartGate';
import { useSessionStore } from '../stores/useSessionStore';
import logger from '../lib/logger';

/**
 * #1045 durable recovery — runs ONCE per authenticated user, after their session list is available, to
 * record any completed session whose Progress evaluation was dropped at save time (a closed tab, an
 * outage). Idempotent and strictly non-fatal: it must never affect rendering or block the app.
 *
 * Mounted app-globally (see `ProgressReconciler` in App.tsx). Owner-scoped via a per-user ref guard, the
 * same pattern used by the analytics-identity effect and `useUnresolvedRecovery`.
 */
export function useProgressReconciliation(): void {
    const { user } = useAuthProvider();
    const { data: sessions } = usePracticeHistory();
    const reconciledForUserRef = useRef<string | null>(null);

    // #1354 CASE 4 — RELOAD RECOVERY. A reload loses the in-memory gate, so without this the recorder
    // renders enabled until something else happens to block it: a flash of enabled Start on a session
    // that still owes durable Progress evidence.
    //
    // This runs as soon as the OWNER RESOLVES and is deliberately independent of the session list. The
    // reconciliation effect below waits for `sessions`, but debt is owner-scoped localStorage — a user
    // whose history has not loaded (or who has no rows at all) can still owe evidence, and waiting
    // would leave exactly the window this closes. Fail-closed comes from `reconstructGateFromQueue`,
    // which reports an unreadable queue as blocked rather than as "nothing owed".
    //
    // Before the owner resolves we publish NOTHING: the durable queue is owner-scoped and cannot be
    // read without one. Enforcement does not depend on this effect — `startRecording` re-reads the
    // durable queue on every attempt regardless — this only makes the UI tell the truth.
    const userId = user?.id ?? null;
    useEffect(() => {
        // No owner: the queue is owner-scoped and cannot be read, so there is nothing to reconstruct.
        // That is still a RESOLVED answer — an anonymous user has no readable debt, and a save without
        // an owner already fails closed at the seam. Leaving it unresolved would disable Start forever.
        if (userId) useSessionStore.getState().setProgressGate(reconstructGateFromQueue(userId));
        // Record WHICH owner this answer belongs to. `''` marks a resolved anonymous visitor, so a
        // signed-out user is not blocked forever, while an account switch invalidates it at once.
        useSessionStore.getState().setProgressGateResolvedFor(userId ?? '');
    }, [userId]);

    // #1354 CASE 4 — CROSS-TAB. `storage` events reach OTHER tabs, never the writer, so a second
    // already-open tab would otherwise keep showing an enabled Start while this tab queues debt. The
    // listener is owner-scoped and re-reads the queue on every event rather than trusting the payload.
    useEffect(() => {
        if (!userId) return undefined;
        return subscribeCrossTabProgressGate(
            () => userId,
            (gate) => useSessionStore.getState().setProgressGate(gate),
        );
    }, [userId]);

    useEffect(() => {
        const userId = user?.id;
        if (!userId || !sessions || sessions.length === 0) return;
        if (reconciledForUserRef.current === userId) return; // once per authenticated user
        reconciledForUserRef.current = userId;

        const reconcilable: ReconcilableSession[] = sessions.map((s) => ({
            id: s.id,
            status: s.status ?? null,
            attribution_status: s.attribution_status ?? null,
            created_at: s.created_at ?? null,
        }));

        void reconcileProgressEvaluations(userId, reconcilable)
            .then((r) => {
                if (r.queueDrained || r.swept) {
                    logger.info({ userId, ...r }, '[progress] on-load reconciliation recorded missing evaluations');
                }
            })
            .catch((err) => logger.warn({ err, userId }, '[progress] on-load reconciliation failed (non-fatal)'));
    }, [user?.id, sessions]);
}
