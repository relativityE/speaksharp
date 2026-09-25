import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { loadSessionProgress } from '@/services/progress/loadSessionProgress';
import { abandonRecommendationAttempt, readPendingRecommendationAttempt, recordRecommendationAttempt } from '@/services/progress/recordProgress';
import { setOpenAttempt } from '@/services/progress/openAttempt';
import logger from '@/lib/logger';

/**
 * #1258 G20 — THE LINKED REPEAT, owned once.
 *
 * Moved verbatim out of `ProgressPanel` so the saved review's single "Practise this again" can run the same linked
 * repeat when it owns the page's next action (PM 2026-09-25), instead of a second button doing it a second way.
 * It records (or reuses) the recommendation attempt, stores the open-attempt handoff, and only then hands over to
 * `afterLinked` — which navigates into the SESSION'S OWN product. A handoff that cannot be stored is abandoned
 * server-side rather than left pending. The progress query key is shared, so both users read one cached result.
 */
export function useLinkedRepeat(sessionId: string) {
    const { user } = useAuthProvider();
    const userId = user?.id ?? null;
    const [accepting, setAccepting] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [retryBlocked, setRetryBlocked] = useState(false);
    const query = useQuery({
        queryKey: ['sessionProgress', sessionId, userId],
        queryFn: () => loadSessionProgress(sessionId),
        enabled: !!sessionId,
        staleTime: 60 * 1000,
    });
    const view = query.data;
    const recommendationId = view?.status === 'eligible' ? view.recommendationId : null;

    const accept = async (afterLinked: () => void): Promise<void> => {
        if (!recommendationId || !userId || accepting) return;
        setAccepting(true);
        setActionError(null);
        setRetryBlocked(false);
        try {
            const pending = await readPendingRecommendationAttempt(recommendationId);
            if (pending.status === 'blocked') throw new Error('pending-attempt-readback-failed');
            const attemptId = pending.status === 'one'
                ? pending.attemptId
                : await recordRecommendationAttempt(recommendationId);
            if (!attemptId) throw new Error('server-attempt-failed');
            const handoffStored = setOpenAttempt({ attemptId, userId, sourceSessionId: sessionId });
            if (!handoffStored) {
                const abandoned = await abandonRecommendationAttempt(attemptId);
                setActionError(abandoned
                    ? 'The repeat could not be linked. Nothing was left pending; please try again.'
                    : 'The repeat could not be linked or safely closed. Retry is unavailable until the pending attempt is reconciled.');
                setRetryBlocked(!abandoned);
                return;
            }
            afterLinked();
        } catch (err) {
            logger.warn({ err, sessionId }, '[progress] accept recommendation failed');
            setActionError('The repeat could not be linked. Stay on this review and try again.');
        } finally {
            setAccepting(false);
        }
    };

    return { query, view, userId, recommendationId, accept, accepting, actionError, setActionError, retryBlocked, setRetryBlocked };
}
