import React from 'react';
import type { ReviewTranscriptOutcome } from '@/services/transcriptAuthority/reviewTranscript';

/**
 * #1416 F-05 — what the review says when there is no transcript to show.
 *
 * Four different facts, four different sentences. The product used to render all of them as an empty
 * transcript, which reads as "your words are gone" regardless of which one is true — and only one of
 * them means anything like that.
 *
 * The distinction that matters most is `pending` versus `expired`. A read that has not finished, or
 * has failed, is NOT retention aging the transcript out. Telling a user their transcript expired when
 * the network merely stalled is a false statement about their own session, and it is unrecoverable
 * from their side: they would stop looking for something that is still there.
 */
export interface ReviewTranscriptNoticeProps {
    outcome: ReviewTranscriptOutcome;
    onRetry?: (() => void) | null;
}

export const ReviewTranscriptNotice: React.FC<ReviewTranscriptNoticeProps> = ({ outcome, onRetry }) => {
    if (outcome.status === 'available') return null;

    const copy = outcome.status === 'expired'
        ? 'This session’s transcript is no longer stored. Your progress and next action are kept.'
        : outcome.status === 'not_captured'
            ? 'No speech was captured in this session.'
            : 'Loading your transcript…';

    return (
        <div
            data-testid="review-transcript-notice"
            data-outcome={outcome.status}
            role="status"
            className="rounded-lg border border-[#e3e8f0] bg-[#f7f9fc] p-3 text-[14px] font-semibold text-[#1f2733]"
        >
            <p>{copy}</p>
            {outcome.status === 'pending' && onRetry && (
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
