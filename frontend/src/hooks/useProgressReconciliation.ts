import { useEffect, useRef } from 'react';
import { useAuthProvider } from '../contexts/AuthProvider';
import { usePracticeHistory } from './usePracticeHistory';
import { reconcileProgressEvaluations, type ReconcilableSession } from '../services/progress/recordProgress';
import { isProgressGateRefusalMessage, reconstructGateFromQueue, subscribeCrossTabProgressGate } from '../services/progress/progressStartGate';
import { scheduleProgressDebtRetry } from '../services/progress/progressDebtRetry';
import { hydrateServerProgressObligations } from '../services/progress/serverProgressObligations';
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
/** #1476: how long the initial server obligation load may hold the Start gate unresolved. */
const SERVER_OBLIGATIONS_TIMEOUT_MS = 4000;

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
        if (!userId) {
            useSessionStore.getState().setProgressGateResolvedFor('');
            return undefined;
        }
        useSessionStore.getState().setProgressGate(reconstructGateFromQueue(userId));
        // #1476 Codex P1 on dae853fb: the owner is RESOLVED only once the server's per-session obligations have been
        // loaded into this device's queue — otherwise a fresh device with an empty local queue shows an enabled Start
        // over server-side debt. Bounded: after the timeout the gate resolves from what is known, and Start itself
        // re-checks the server before any engine work. Records WHICH owner the answer belongs to (`''` = anonymous).
        // Codex P1 on 0200e7829: the timeout RESOLVES the gate, but it no longer abandons the load. The scan keeps running
        // for this owner while this effect is mounted, and when it lands the gate is republished from the durable queue —
        // debt it queued after the timeout still gets its bounded retry. After unmount a late answer writes nothing.
        let mounted = true;
        let resolved = false;
        const publish = () => {
            if (!mounted) return;
            useSessionStore.getState().setProgressGate(reconstructGateFromQueue(userId));
            if (!resolved) {
                resolved = true;
                useSessionStore.getState().setProgressGateResolvedFor(userId);
            }
        };
        const timer = setTimeout(publish, SERVER_OBLIGATIONS_TIMEOUT_MS);
        void hydrateServerProgressObligations(userId, new Date().toISOString(), undefined, { isLive: () => mounted })
            .catch((err) => logger.warn({ err }, '[progress] server obligation load failed (non-fatal)'))
            .finally(() => { clearTimeout(timer); publish(); });
        return () => { mounted = false; clearTimeout(timer); };
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

    // RWT-20 — BOUNDED IN-PAGE RETRY. A `queued` gate (reconstructed on reload, or published by a failed save in this
    // tab) used to wait for the NEXT page load while the card promised an automatic retry; in Production that held
    // Start for ~88 minutes. The schedule retries on a bounded backoff, then releases Start while the debt stays
    // durable. It is single-flight per owner, so repeated gate publications never multiply attempts.
    const progressGate = useSessionStore((st) => st.progressGate);
    const queuedSessionId = userId && progressGate?.state === 'queued' && progressGate.ownerId === userId
        ? progressGate.sessionId
        : null;
    useEffect(() => {
        if (!userId || !queuedSessionId) return undefined;
        let current = true;
        void scheduleProgressDebtRetry(userId)
            // When the schedule settles, rebuild the visible gate from the durable queue (Codex 4003102441). A `queued`
            // gate published after another tab cleared its debt would otherwise hold Start forever. Empty clears it,
            // remaining debt stays queued, unreadable stays unresolved; a settlement that outlived this owner or mount
            // publishes nothing.
            .then(() => { if (current) useSessionStore.getState().setProgressGate(reconstructGateFromQueue(userId)); })
            .catch((err) => logger.warn({ err }, '[progress] bounded debt retry failed (non-fatal)'));
        return () => { current = false; };
    }, [userId, queuedSessionId]);

    // Canary 36142201470 — THE GATE'S OWN REFUSAL COPY NEVER OUTLIVES OR DUPLICATES THE GATE. A Start refused on Progress
    // debt writes the gate's copy ("Finishing up your last session — …") into the recorder status as an error. For the
    // resolved owner that copy is removed from the status as soon as the gate is published:
    //   - gate present → the gate's own notice already says exactly this, once, in the recorder (no red duplicate);
    //   - gate cleared → the copy is stale; it sat beside "Mic ready" promising a start that never came.
    // Only the gate's own refusal copy is touched; the page returns to rest and the person presses Start again (nothing
    // records on its own).
    const gateResolvedFor = useSessionStore((st) => st.progressGateResolvedFor);
    const sttMessage = useSessionStore((st) => (st.sttStatus.type === 'error' ? st.sttStatus.message : null));
    useEffect(() => {
        if (!userId || gateResolvedFor !== userId) return;
        if (!isProgressGateRefusalMessage(sttMessage)) return;
        useSessionStore.getState().setSTTStatus({ type: 'idle', message: 'Ready to record' });
    }, [userId, gateResolvedFor, progressGate, sttMessage]);

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
