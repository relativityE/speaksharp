/**
 * #1258 (Rev 2 §4.2; PO 2026-10-09) — a reopened session that has no saved review gets the §2 failed band with an
 * EXPLICIT Try again. Nothing is requested on re-entry: only the press mounts `AISuggestions`, which then makes its one
 * request for this saved session id and shows its own result or failure band. This press is the ONE allowed exception
 * to "only the post-Stop review requests coaching", and only for a saved session with no coaching.
 *
 * The coaching function reads the transcript server-side, so a retry is real only while the session keeps it. When it
 * doesn't (transcript retention), the band is terminal — "Review isn't available for this session" — with no button,
 * never a fake retry. A transcript that expires between render and press still ends terminal: the function answers 409
 * and `AISuggestions` shows its no-transcript message.
 */
import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import AISuggestions from './AISuggestions';
import { FOCUS_POINTS_DISCLOSURE, NOT_AVAILABLE_FOR_SESSION_MESSAGE, OPEN_MIC_DISCLOSURE, UNAVAILABLE_MESSAGE } from './reviewCopy';
import type { SessionProduct } from '@/types/session';

interface RestoredReviewRetryProps {
    sessionId: string;
    product: SessionProduct | null;
    sessionLabel?: string | null;
    /** The saved row says its transcript is still kept (`resolveTranscriptView(...).kind === 'available'`). */
    transcriptAvailable: boolean;
    /** The saved review's own "Practice again?" action, kept before and after Try again (#1577 Codex P2 4235188535). */
    action?: React.ReactNode;
}

export const RestoredReviewRetry: React.FC<RestoredReviewRetryProps> = ({ sessionId, product, sessionLabel, transcriptAvailable, action }) => {
    const [requested, setRequested] = useState(false);
    // #1577 Codex P2 4235535994: with no resolved product the coaching function answers product_unknown, so a retry could
    // never generate coaching. Terminal: no button, no claimed send, no request.
    const canRetry = transcriptAvailable && product !== null;
    if (requested) {
        // #1577 Codex P2 4235535990: AISuggestions has no ground of its own; loading, failure and success all stay on the
        // same ink review surface, with the practice action.
        return (
            <section className="rounded-2xl bg-ink p-6" data-testid="restored-review-requested" aria-label="Practice Loop review">
                <AISuggestions canReview sessionId={sessionId} product={product ?? undefined} sessionLabel={sessionLabel ?? null} />
                {action}
            </section>
        );
    }
    return (
        <section className="rounded-2xl bg-ink p-6" data-testid="restored-review-retry" data-retry={canRetry ? 'available' : 'unavailable'} aria-label="Practice Loop review">
            <h2 className="mb-4 inline-flex items-center gap-2 text-[12px] font-extrabold uppercase tracking-[0.09em] text-signature">
                <Sparkles className="h-[15px] w-[15px]" aria-hidden="true" />
                Practice Loop review
            </h2>
            {canRetry ? (
                <>
                    <p className="max-w-[560px] text-[17px] font-bold leading-snug text-ink-text">{UNAVAILABLE_MESSAGE}</p>
                    <button
                        type="button"
                        onClick={() => setRequested(true)}
                        className="mt-3.5 inline-flex h-10 items-center rounded-lg border border-ink-muted px-4 text-[14px] font-extrabold text-ink-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
                        data-testid="restored-review-retry-button"
                    >
                        Try again
                    </button>
                    <p className="mt-2 text-[12px] font-semibold text-ink-muted">
                        {product === 'focus_points' ? FOCUS_POINTS_DISCLOSURE : OPEN_MIC_DISCLOSURE}
                    </p>
                </>
            ) : (
                <p className="max-w-[560px] text-[17px] font-bold leading-snug text-ink-text" data-testid="restored-review-not-available">
                    {NOT_AVAILABLE_FOR_SESSION_MESSAGE}
                </p>
            )}
            {action}
        </section>
    );
};
