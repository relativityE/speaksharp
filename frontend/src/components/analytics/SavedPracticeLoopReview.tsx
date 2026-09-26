import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { PracticeLoopReviewPair } from '@/components/review/PracticeLoopReviewPair';
import { loadSavedSessionReview, type SavedSessionReview } from '@/services/review/savedSessionReview';
import { useLinkedRepeat } from '@/hooks/useLinkedRepeat';
import { useSessionStore } from '@/stores/useSessionStore';
import { PRODUCT_NAMES } from '@/constants/productNames';
import { trackSavedReviewPracticeSelected, trackSavedReviewRevisited } from '@/services/reviewSurfaceTelemetry';

const PRACTICE_AGAIN = 'Practice this again';

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
    const repeat = useLinkedRepeat(sessionId);

    useEffect(() => {
        let active = true;
        void loadSavedSessionReview(sessionId).then((value) => { if (active) setSaved({ sessionId, value }); });
        return () => { active = false; };
    }, [sessionId]);

    const review = saved && saved.sessionId === sessionId ? saved.value : null;

    // #1258 (PM 2026-09-25): showing the SAVED review is a revisit, once per session per page view — its own event,
    // never a generation. Content-free: product, which state showed, and whether an evidence line showed.
    const revisitSentFor = useRef<string | null>(null);
    useEffect(() => {
        if (!review || revisitSentFor.current === sessionId) return;
        revisitSentFor.current = sessionId;
        trackSavedReviewRevisited(review.product, review.coaching.kind, review.coaching.kind === 'review' && review.evidence.length > 0);
    }, [review, sessionId]);
    const productName = review?.product === 'focus_points' ? PRODUCT_NAMES.objective
        : review?.product === 'open_mic' ? PRODUCT_NAMES.freeform : null;
    const label = [sessionLabel, productName].filter(Boolean).join(' · ');

    const openProduct = () => {
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
                navigate('/session');
            } else {
                navigate('/practice?product=focus-points');
            }
            return;
        }
        if (review?.product === 'open_mic') {
            store.setActiveObjectiveBrief(null);
            navigate('/session');
            return;
        }
        navigate('/practice');
    };
    const practise = () => {
        trackSavedReviewPracticeSelected(review?.product ?? 'unknown', Boolean(repeat.recommendationId));
        if (repeat.recommendationId) void repeat.accept(openProduct);
        else openProduct();
    };

    const action = (
        <div>
            <button
                type="button"
                onClick={practise}
                disabled={!review || repeat.accepting || repeat.retryBlocked}
                data-testid="saved-review-practice"
                className="rounded-lg bg-ink px-5 py-3 text-[15px] font-bold text-ink-text hover:brightness-110 disabled:opacity-60"
            >
                {repeat.accepting ? 'Linking repeat…' : PRACTICE_AGAIN}
            </button>
            {repeat.actionError && (
                <p role="alert" className="mt-2 text-[13px] font-semibold text-ink" data-testid="saved-review-practice-error">{repeat.actionError}</p>
            )}
        </div>
    );

    const coaching = review?.coaching;
    const STATE_COPY: Record<'none' | 'expired' | 'error', string> = {
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
