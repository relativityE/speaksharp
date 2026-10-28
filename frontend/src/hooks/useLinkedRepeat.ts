import { useEffect, useRef, useState } from 'react';
import { trackSavedReviewLinkedAttempt, type LinkedAttemptOutcome, type PracticeIntendedRoute } from '@/services/reviewSurfaceTelemetry';
import { useQuery } from '@tanstack/react-query';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { loadSessionProgress } from '@/services/progress/loadSessionProgress';
import { abandonRecommendationAttempt, readPendingRecommendationAttempt, recordRecommendationAttempt } from '@/services/progress/recordProgress';
import { getOpenAttemptForUser, openAttemptSnapshot, setOpenAttempt } from '@/services/progress/openAttempt';
import { isCurrentTargetOwner, resolveRepeatTarget, validateDisplayedTarget, type DisplayedRepeatTarget } from '@/services/progress/repeatPracticeTarget';
import { authEpoch } from '@/services/loginSessionLog';
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
    const { user, signedOutByUser } = useAuthProvider();
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
    const generation = useRef(0);
    const identity = `${userId}|${sessionId}|${authEpoch()}|${Boolean(signedOutByUser)}`;
    const lastIdentity = useRef(identity);
    if (lastIdentity.current !== identity) { lastIdentity.current = identity; generation.current += 1; }
    useEffect(() => () => { generation.current += 1; }, []);
    useEffect(() => {
        acceptingRef.current = false;
        setAccepting(false); setActionError(null); setRetryBlocked(false);
    }, [identity]);

    const accept = async (afterLinked: () => void, actionSeq = 1, intendedRoute: PracticeIntendedRoute = 'none', target?: DisplayedRepeatTarget): Promise<void> => {
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
        const startedGeneration = generation.current;
        const startedEpoch = authEpoch();
        const initialHandoff = target ? openAttemptSnapshot() : null;
        const current = () => authEpoch() === startedEpoch && generation.current === startedGeneration && (!target || (
            !signedOutByUser && target.ownerId === userId && target.sessionId === sessionId
            && isCurrentTargetOwner(target.ownerId, target.epoch) && target.isCurrent()
            && openAttemptSnapshot() === initialHandoff));
        const checkCurrent = () => { if (!current()) throw new Error('repeat-acceptance-retired'); };
        acceptingRef.current = true;
        setAccepting(true);
        setActionError(null);
        setRetryBlocked(false);
        try {
            const reference = target ? await validateDisplayedTarget(target) : undefined;
            checkCurrent();
            const pending = await readPendingRecommendationAttempt(recommendationId);
            checkCurrent();
            if (pending.status === 'blocked') { outcome = 'readback_blocked'; throw new Error('pending-attempt-readback-failed'); }
            const attemptId = pending.status === 'one'
                ? pending.attemptId
                : await recordRecommendationAttempt(recommendationId);
            checkCurrent();
            if (!attemptId) { outcome = 'server_failed'; throw new Error('server-attempt-failed'); }
            if (target && reference) await resolveRepeatTarget(userId, sessionId, reference, current);
            checkCurrent();
            // A REUSED attempt (its create committed but the answer was lost) is accepted at THIS press (Codex P2 r4273828962,
            // r4275389955, r4275718056; PM 6178959404). No request names an attempt before the server answers, so nothing
            // proves which earlier press — on this device or another — created it, and the server's clock is never mixed
            // into client ordering. Known limitation: a take recorded between the lost create and this press stays
            // unlinked; it is never bound to a take that may predate the attempt.
            const handoffStored = setOpenAttempt({ attemptId, userId, sourceSessionId: sessionId, acceptedAtIso,
                ...(reference ? { repeatTarget: reference } : {}) });
            if (!handoffStored) {
                // A replacement account must never issue this original owner's cleanup request.
                if (authEpoch() !== startedEpoch || (target && !isCurrentTargetOwner(target.ownerId, target.epoch))) return;
                if (target && openAttemptSnapshot() !== initialHandoff) {
                    outcome = 'handoff_failed_unclosed';
                    setRetryBlocked(true);
                    setActionError('The repeat handoff changed. Reconcile the pending repeat in Progress before trying again.');
                    return;
                }
                const abandoned = await abandonRecommendationAttempt(attemptId);
                if (authEpoch() !== startedEpoch || generation.current !== startedGeneration || (target && !isCurrentTargetOwner(target.ownerId, target.epoch))) return;
                setActionError(abandoned
                    ? 'The repeat could not be linked. Nothing was left pending; please try again.'
                    : 'The repeat could not be linked or safely closed. Retry is unavailable until the pending attempt is reconciled.');
                setRetryBlocked(!abandoned);
                outcome = abandoned ? 'handoff_failed_abandoned' : 'handoff_failed_unclosed';
                return;
            }
            if (authEpoch() !== startedEpoch || generation.current !== startedGeneration) return;
            if (target) {
                const stored = getOpenAttemptForUser(userId);
                if (!target.isCurrent() || !isCurrentTargetOwner(target.ownerId, target.epoch) || !stored
                    || stored.attemptId !== attemptId || stored.sourceSessionId !== sessionId || stored.acceptedAtIso !== acceptedAtIso
                    || JSON.stringify(stored.repeatTarget) !== JSON.stringify(reference)) throw new Error('repeat-handoff-replaced');
            }
            outcome = 'ok';
            afterLinked();
        } catch (err) {
            if (!current()) return;
            logger.warn(target ? { sessionId } : { err, sessionId }, '[progress] accept recommendation failed');
            setActionError(target ? 'This review’s practice target could not be verified. Stay on this review and retry the same target.'
                : 'The repeat could not be linked. Stay on this review and try again.');
        } finally {
            if (generation.current === startedGeneration) acceptingRef.current = false;
            if (authEpoch() === startedEpoch && generation.current === startedGeneration && (!target || isCurrentTargetOwner(target.ownerId, target.epoch))) {
                setAccepting(false);
                trackSavedReviewLinkedAttempt(outcome, performance.now() - startedAt, actionSeq, intendedRoute);
            }
        }
    };

    return { query, view, userId, signedOutByUser, recommendationId, linkState, accept, accepting, actionError, setActionError, retryBlocked, setRetryBlocked };
}
