import { useEffect, useRef } from 'react';
import { useAuthProvider } from '../contexts/AuthProvider';
import { usePracticeHistory } from './usePracticeHistory';
import { reconcileProgressEvaluations, type ReconcilableSession } from '../services/progress/recordProgress';
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
