import React from 'react';
import type { TranscriptView } from '@/lib/storage';

/**
 * #1416 F-05 — what the review says when there is no transcript to show.
 *
 * Consumes `resolveTranscriptView`, the EXISTING authority. Its docstring already names itself "the
 * ONE place that decides whether a session's transcript may be shown", shared by the review surface
 * and the PDF "so the two cannot drift" — so a second resolver here would be the drift it was written
 * to prevent. I built one before reading it; this is that mistake removed.
 *
 * The one thing that authority cannot know is whether finalization has settled, because it reads a
 * saved row and finalization is a client lifecycle. `unavailable` therefore means two different
 * things to a user, and they need different sentences:
 *
 *   still finalizing  → "Loading" — a wait, not an absence.
 *   settled           → "We couldn't load it" — an honest failure, with a retry.
 *
 * Neither may say "expired". Telling users their transcript aged out when the read merely stalled is
 * a false statement about their own session, and unrecoverable from their side: they stop looking for
 * something that is still there.
 */
export interface ReviewTranscriptNoticeProps {
    view: TranscriptView;
    /** True while finalization is still running — an `unavailable` view is then a wait, not a failure. */
    isFinalizing: boolean;
    onRetry?: (() => void) | null;
}

export const ReviewTranscriptNotice: React.FC<ReviewTranscriptNoticeProps> = ({ view, isFinalizing, onRetry }) => {
    if (view.kind === 'available') return null;

    const outcome = view.kind === 'unavailable' && isFinalizing ? 'pending' : view.kind;
    const copy = view.kind === 'expired'
        ? 'This session’s transcript is no longer stored. Your progress and next action are kept.'
        : view.kind === 'not_captured'
            ? 'No speech was captured in this session.'
            : isFinalizing
                ? 'Loading your transcript…'
                : 'We couldn’t load your transcript. It may still be saved — try again.';

    return (
        <div
            data-testid="review-transcript-notice"
            data-outcome={outcome}
            role="status"
            className="rounded-lg border border-[#e3e8f0] bg-[#f7f9fc] p-3 text-[14px] font-semibold text-[#1f2733]"
        >
            <p>{copy}</p>
            {view.kind === 'unavailable' && !isFinalizing && onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    data-testid="review-transcript-retry"
                    className="mt-2 text-[13px] font-bold text-[#0d7d74] hover:underline"
                >
                    Try again
                </button>
            )}
        </div>
    );
};
