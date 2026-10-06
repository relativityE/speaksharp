import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { PracticeLoopReviewPair } from '@/components/review/PracticeLoopReviewPair';
import { loadSavedSessionReview, type SavedSessionReview } from '@/services/review/savedSessionReview';
import { useLinkedRepeat } from '@/hooks/useLinkedRepeat';
import { useSessionStore } from '@/stores/useSessionStore';
import { PRODUCT_NAMES } from '@/constants/productNames';
import {
    trackSavedReviewPracticeAction, trackSavedReviewPracticeSelected, trackSavedReviewPracticeState, trackSavedReviewRevisited,
    type PracticeActionTaken, type PracticeBlockedReason, type PracticeIntendedRoute, type PracticeProgressStatus, type PracticeReviewState,
} from '@/services/reviewSurfaceTelemetry';

const PRACTICE_AGAIN = 'Practice this again';
/** A MARKED Focus Points take whose saved results couldn't be read; its practice action retries the read. */
const FOCUS_RESULTS_READ_FAILED = 'This take’s Focus Points couldn’t be loaded, so practice wasn’t started. Try again.';

/**
 * #1258 G20 — the saved Practice Loop review, first on the Analytics session detail (Where A).
 *
 * Shows the pair the Session page generated after Stop, word for word, from the saved row — never a new review
 * (`loadSavedSessionReview` never calls the coaching function). It owns the page's ONE next action:
 *   - Focus Points: rebinds THIS session's saved point set, so the next take practises the same points; never a
 *     different set. Without the saved set it opens Focus Points setup instead of guessing.
 *   - Open Mic: opens Open Mic with no Focus Points brief left bound.
 *   - When Progress has a valid linked recommendation, the same linked repeat runs first (`useLinkedRepeat`).
 * With no saved review (A3) it says so, with no stand-in lesson and no generate button. (A completed session missing
 * its next-action signal keeps its data-integrity error on the detail page — PM 2026-09-25.)
 */
export const SavedPracticeLoopReview: React.FC<{ sessionId: string; sessionLabel?: string | null }> = ({ sessionId, sessionLabel }) => {
    const navigate = useNavigate();
    const [saved, setSaved] = useState<{ sessionId: string; value: SavedSessionReview } | null>(null);
    const [readAttempt, setReadAttempt] = useState(0);
    const repeat = useLinkedRepeat(sessionId);

    useEffect(() => {
        let active = true;
        void loadSavedSessionReview(sessionId).then((value) => { if (active) setSaved({ sessionId, value }); });
        return () => { active = false; };
    }, [sessionId, readAttempt]);

    const review = saved && saved.sessionId === sessionId ? saved.value : null;

    // #1258 (PM 2026-09-25): showing the SAVED review is a revisit, once per session per page view — its own event,
    // never a generation. Content-free: product, which state showed, and whether an evidence line showed.
    const revisitSentFor = useRef<string | null>(null);
    useEffect(() => {
        if (!review || revisitSentFor.current === sessionId) return;
        revisitSentFor.current = sessionId;
        // #1538: an unverified (generic v1) Focus pair is not shown, so it is never a qualifying review impression — it is
        // reported as `none` (the closed `review_state` enum is unchanged).
        trackSavedReviewRevisited(review.product, review.coaching.kind === 'unverified' ? 'none' : review.coaching.kind, review.coaching.kind === 'review' && review.evidence.length > 0);
    }, [review, sessionId]);
    const productName = review?.product === 'focus_points' ? PRODUCT_NAMES.objective
        : review?.product === 'open_mic' ? PRODUCT_NAMES.freeform : null;
    const label = [sessionLabel, productName].filter(Boolean).join(' · ');

    const routeClass = (t: 'open_session' | 'open_focus_setup' | 'open_practice'): PracticeIntendedRoute =>
        t === 'open_session' ? 'session' : t === 'open_focus_setup' ? 'focus_setup' : 'practice';
    /** Where `openProduct` goes for this review — computed once, so the recorded action and the navigation agree. */
    const productTarget = (): Extract<PracticeActionTaken, 'open_session' | 'open_focus_setup' | 'open_practice'> => {
        if (review?.product === 'focus_points') return review.focusBrief && review.focusPoints.length > 0 ? 'open_session' : 'open_focus_setup';
        return review?.product === 'open_mic' ? 'open_session' : 'open_practice';
    };
    // #1258 (Codex r4191751371): the press's `action_seq` travels in router state (memory only, never the URL), so the
    // destination can emit `saved_review_practice_arrived` proving THIS press caused THIS arrival.
    const openProduct = (actionSeq: number) => {
        const go = (to: string) => navigate(to, { state: { practiceActionSeq: actionSeq } });
        const store = useSessionStore.getState();
        if (review?.product === 'focus_points') {
            if (review.focusBrief && review.focusPoints.length > 0) {
                store.setActiveObjectiveBrief({
                    projectId: review.focusBrief.projectId,
                    briefId: review.focusBrief.briefId,
                    points: review.focusPoints,
                    topic: review.focusBrief.topic,
                    // The pace guide is not saved with the session; the next take runs without one.
                    paceGuideSecPerPoint: null,
                });
                go('/session');
            } else {
                go('/practice?product=focus-points');
            }
            return;
        }
        if (review?.product === 'open_mic') {
            store.setActiveObjectiveBrief(null);
            go('/session');
            return;
        }
        go('/practice');
    };
    // #1258 (PM RETURN, #1535 cycle 1): act only on a KNOWN progress answer. While it is loading nothing navigates (a
    // fast click must not skip a valid linked repeat); a failed read stays here with its error and a retry; an eligible
    // recommendation runs its one linked attempt first; only a terminal "nothing to link" opens the product directly.
    // #1258: every press is recorded with the branch it took (`saved_review_practice_action`); `action_seq` links a
    // press to the linked attempt it started. Closed enums only: no session id, review text or route.
    const actionSeqRef = useRef(0);
    const practise = () => {
        const actionSeq = Math.min(100, ++actionSeqRef.current);
        const reviewState: PracticeReviewState = !review ? 'loading'
            : review.reviewReadFailed ? 'read_failed' : review.focusReadFailed ? 'focus_read_failed' : 'loaded';
        const progressStatus: PracticeProgressStatus = repeat.view?.status
            ?? (repeat.query.isPending ? 'loading' : repeat.query.isError ? 'read_error' : 'unknown');
        const record = (action: PracticeActionTaken) => trackSavedReviewPracticeAction({
            product: review?.product ?? 'unknown', linkState: repeat.linkState, reviewState, progressStatus, action, actionSeq,
            intendedRoute: action === 'accept_linked' ? routeClass(productTarget())
                : action === 'open_session' || action === 'open_focus_setup' || action === 'open_practice' ? routeClass(action) : 'none',
        });
        if (!review || repeat.linkState === 'pending' || repeat.linkState === 'blocked' || repeat.accepting) { record('ignored'); return; }
        // PM RETURN 5849471237: a marked Focus take whose point set couldn't be read never opens a generic or unlinked
        // practice; the action re-reads the saved review, and the repeat runs only once the set is back.
        // #1535 (Codex P2 r4116859975): a failed read of the review ITSELF is retried the same way — never the generic
        // product chooser a genuinely unmarked legacy session opens.
        if (review.focusReadFailed || review.reviewReadFailed) {
            record('reread_review');
            setSaved(null);
            setReadAttempt((n) => n + 1);
            return;
        }
        if (repeat.linkState === 'error') {
            record('refetch_progress');
            void repeat.query.refetch();
            return;
        }
        trackSavedReviewPracticeSelected(review.product, repeat.linkState === 'linked');
        if (repeat.linkState === 'linked') {
            record('accept_linked');
            void repeat.accept(() => openProduct(actionSeq), actionSeq, routeClass(productTarget()));
        } else {
            record(productTarget());
            openProduct(actionSeq);
        }
    };
    const progressReadFailed = repeat.linkState === 'error' && !repeat.query.isFetching;

    // #1258: the action's availability, recorded when it CHANGES (a disabled action emits no press, so it would
    // otherwise be a silent gap). Same predicate as the button's `disabled`, named by its first unmet condition.
    const blockedReason: PracticeBlockedReason = !review ? 'review_loading'
        : repeat.accepting ? 'linking'
            : repeat.retryBlocked ? 'retry_blocked'
                : repeat.linkState === 'pending' ? 'progress_pending'
                    : repeat.linkState === 'blocked' ? 'previous_attempt_pending'
                        : repeat.linkState === 'error' && repeat.query.isFetching ? 'progress_refetching' : 'none';
    const stateReviewState: PracticeReviewState = !review ? 'loading'
        : review.reviewReadFailed ? 'read_failed' : review.focusReadFailed ? 'focus_read_failed' : 'loaded';
    const stateSignature = useRef<string | null>(null);
    useEffect(() => {
        const state = { product: review?.product ?? 'unknown', linkState: repeat.linkState, reviewState: stateReviewState,
            enabled: blockedReason === 'none', blockedReason } as const;
        const signature = JSON.stringify(state);
        if (signature === stateSignature.current) return;
        stateSignature.current = signature;
        trackSavedReviewPracticeState(state);
    }, [review?.product, repeat.linkState, stateReviewState, blockedReason]);

    const action = (
        <div>
            <button
                type="button"
                onClick={practise}
                disabled={blockedReason !== 'none'}
                data-testid="saved-review-practice"
                data-link-state={repeat.linkState}
                className="rounded-lg bg-ink px-5 py-3 text-[15px] font-bold text-ink-text hover:brightness-110 disabled:opacity-60"
            >
                {review?.focusReadFailed || review?.reviewReadFailed ? 'Try again'
                    : repeat.accepting ? 'Linking repeat…'
                    : repeat.linkState === 'pending' || (repeat.linkState === 'error' && repeat.query.isFetching) ? 'Checking your next practice…'
                        : progressReadFailed ? 'Try again'
                            : PRACTICE_AGAIN}
            </button>
            {repeat.linkState === 'blocked' && (
                <p role="alert" className="mt-2 text-[13px] font-semibold text-ink" data-testid="saved-review-pending-attempt">
                    A previous repeat is still pending. Close it in Progress below before starting another.
                </p>
            )}
            {review?.focusReadFailed && (
                <p role="alert" className="mt-2 text-[13px] font-semibold text-ink" data-testid="saved-review-focus-error">
                    {FOCUS_RESULTS_READ_FAILED}
                </p>
            )}
            {!review?.focusReadFailed && !review?.reviewReadFailed && progressReadFailed && (
                <p role="alert" className="mt-2 text-[13px] font-semibold text-ink" data-testid="saved-review-progress-error">
                    Your next practice couldn’t be checked, so it wasn’t started. Try again.
                </p>
            )}
            {repeat.actionError && (
                <p role="alert" className="mt-2 text-[13px] font-semibold text-ink" data-testid="saved-review-practice-error">{repeat.actionError}</p>
            )}
        </div>
    );

    const coaching = review?.coaching;
    const STATE_COPY: Record<'none' | 'expired' | 'error' | 'unverified', string> = {
        unverified: 'This session’s coaching was saved before Focus Points coaching was available, so it isn’t shown here.',
        none: 'No coaching was saved for this session.',
        expired: 'This session’s coaching is no longer available; it is removed with the transcript.',
        error: 'This session’s coaching couldn’t be loaded. Reload to try again.',
    };

    return (
        <section
            className="rounded-2xl bg-ink p-6"
            data-testid="saved-review"
            data-review-state={coaching?.kind ?? 'loading'}
            data-product={review?.product ?? 'loading'}
            aria-label="Practice Loop review"
        >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3.5 gap-y-1">
                <h2 className="inline-flex items-center gap-2 text-[12px] font-extrabold uppercase tracking-[0.09em] text-signature">
                    <Sparkles className="h-[15px] w-[15px]" aria-hidden="true" />
                    Practice Loop review
                </h2>
                {label && <span className="min-w-0 text-[12px] font-bold text-ink-muted" data-testid="saved-review-label">{label}</span>}
            </div>

            {!review && <p className="text-[15px] font-semibold text-ink-muted" data-testid="saved-review-loading">Loading this session’s review…</p>}

            {coaching?.kind === 'review' && (
                <PracticeLoopReviewPair
                    testId="saved-review-pair"
                    whatWorked={coaching.review.whatWorked}
                    whatToTryNext={coaching.review.whatToTryNext}
                    evidence={review?.evidence}
                    action={action}
                />
            )}

            {coaching && coaching.kind !== 'review' && (
                <div>
                    <p className="text-[20px] font-extrabold leading-snug text-ink-text" data-testid={`saved-review-${coaching.kind}`} role="status">
                        {STATE_COPY[coaching.kind]}
                    </p>
                    <div className="mt-4 [&_button]:bg-signature [&_button]:text-ink">{action}</div>
                </div>
            )}

        </section>
    );
};

export default SavedPracticeLoopReview;
