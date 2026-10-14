import { useRef, useState } from 'react';
import { trackSavedReviewLinkedAttempt, type LinkedAttemptOutcome, type PracticeIntendedRoute } from '@/services/reviewSurfaceTelemetry';
import { useQuery } from '@tanstack/react-query';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { loadSessionProgress } from '@/services/progress/loadSessionProgress';
import { abandonRecommendationAttempt, readPendingRecommendationAttempt, recordRecommendationAttempt } from '@/services/progress/recordProgress';
import { attemptPressFor, clearAttemptPress, recordAttemptPress, setOpenAttempt } from '@/services/progress/openAttempt';
import logger from '@/lib/logger';

/**
 * #1258 G20 — THE LINKED REPEAT, owned once.
 *
 * Moved verbatim out of `ProgressPanel` so the saved review's single "Practise this again" can run the same linked
 * repeat when it owns the page's next action (PM 2026-09-25), instead of a second button doing it a second way.
 * It records (or reuses) the recommendation attempt, stores the open-attempt handoff, and only then hands over to
 * `afterLinked` — which navigates into the SESSION'S OWN product. A handoff that cannot be stored is abandoned
 * server-side rather than left pending. The progress query key is shared, so both users read one cached result.
 *
 * #1258 (PM RETURN, #1535 cycle 1): `recommendationId === null` does NOT mean "no linked repeat" — it is also null
 * while the progress query is still loading and when it failed. `linkState` says which it is, so a caller never
 * navigates unlinked on a guess:
 *   - `pending`: the answer is not known yet — no navigation of any kind;
 *   - `error`: the progress read failed (or is not available yet) — stay on the review, show it, offer a retry;
 *   - `linked`: an eligible recommendation exists — run exactly one linked attempt/handoff, then open the product;
 *   - `direct`: ONLY a terminal `insufficient` or `ineligible` answer — open directly.
 * `eligible` without a recommendation is not a permission to skip the link (PM RETURN cycle 2): it is `error`.
 *   - `blocked` (#1535 Codex P2 r4116741455): the previous linked repeat is still PENDING — no new take may reuse it;
 *     the person closes it with Progress's "Close pending repeat", whose refetch of this shared query restores `linked`.
 */
export type LinkState = 'pending' | 'error' | 'blocked' | 'linked' | 'direct';
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
    const pendingPreviousAttempt = view?.status === 'eligible' && view.latestAttempt?.lifecycle === 'pending';
    const linkState: LinkState = query.isPending ? 'pending'
        : !query.isError && pendingPreviousAttempt ? 'blocked'
        : !query.isError && (view?.status === 'insufficient' || view?.status === 'ineligible') ? 'direct'
            : !query.isError && view?.status === 'eligible' && typeof recommendationId === 'string' && recommendationId.length > 0 ? 'linked'
                : 'error';
    // A second press in the same frame reads the same `accepting` state; the ref makes the attempt single-flight.
    const acceptingRef = useRef(false);

    const accept = async (afterLinked: () => void, actionSeq = 1, intendedRoute: PracticeIntendedRoute = 'none'): Promise<void> => {
        const startedAt = performance.now();
        if (!recommendationId || !userId || accepting || acceptingRef.current || pendingPreviousAttempt) {
            trackSavedReviewLinkedAttempt('not_started', 0, actionSeq, intendedRoute);
            return;
        }
        // #1258 Codex P1 r4273670998: the acceptance moment is the PRESS. Captured before either server call, so a slow
        // readback or create cannot push it past a take another tab saves meanwhile (which would then never be bound).
        const acceptedAtIso = new Date().toISOString();
        // #1258: the outcome of THIS attempt, emitted once in `finally`; an exception with no recorded stage is 'threw'.
        let outcome: LinkedAttemptOutcome = 'threw';
        acceptingRef.current = true;
        setAccepting(true);
        setActionError(null);
        setRetryBlocked(false);
        try {
            const pending = await readPendingRecommendationAttempt(recommendationId);
            if (pending.status === 'blocked') { outcome = 'readback_blocked'; throw new Error('pending-attempt-readback-failed'); }
            // Codex P2 r4275389955: the create's press is recorded (client clock) BEFORE the call, so a create that commits
            // but loses its answer is reused below with that original press — not this later retry press, and never the
            // server's own clock.
            if (pending.status !== 'one') recordAttemptPress(userId, recommendationId, acceptedAtIso);
            const attemptId = pending.status === 'one'
                ? pending.attemptId
                : await recordRecommendationAttempt(recommendationId);
            if (!attemptId) { outcome = 'server_failed'; throw new Error('server-attempt-failed'); }
            // Codex P2 r4273828962: a REUSED attempt keeps the press that created it when this browser recorded one;
            // unknown (created elsewhere) keeps this press — the conservative choice: it never binds an earlier take.
            const originalPress = pending.status === 'one' ? attemptPressFor(userId, recommendationId) : null;
            const handoffAcceptedAt = originalPress && originalPress < acceptedAtIso ? originalPress : acceptedAtIso;
            const handoffStored = setOpenAttempt({ attemptId, userId, sourceSessionId: sessionId, acceptedAtIso: handoffAcceptedAt });
            if (!handoffStored) {
                const abandoned = await abandonRecommendationAttempt(attemptId);
                setActionError(abandoned
                    ? 'The repeat could not be linked. Nothing was left pending; please try again.'
                    : 'The repeat could not be linked or safely closed. Retry is unavailable until the pending attempt is reconciled.');
                setRetryBlocked(!abandoned);
                outcome = abandoned ? 'handoff_failed_abandoned' : 'handoff_failed_unclosed';
                return;
            }
            clearAttemptPress(userId, recommendationId); // the handoff now carries the acceptance time
            outcome = 'ok';
            afterLinked();
        } catch (err) {
            logger.warn({ err, sessionId }, '[progress] accept recommendation failed');
            setActionError('The repeat could not be linked. Stay on this review and try again.');
        } finally {
            acceptingRef.current = false;
            setAccepting(false);
            trackSavedReviewLinkedAttempt(outcome, performance.now() - startedAt, actionSeq, intendedRoute);
        }
    };

    return { query, view, userId, recommendationId, linkState, accept, accepting, actionError, setActionError, retryBlocked, setRetryBlocked };
}
