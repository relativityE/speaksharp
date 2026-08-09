import React from 'react';
import { PromptOffer } from './PromptOffer';

/**
 * #1222 slot B — the Live Transcript card. ONE card rendered in all three states (empty+offer / live /
 * seekable); it never remounts or moves (spec §1). This slice (S3) owns the **before** state: the dashed
 * empty frame, the prompt offer overlaid inside it (never its own card, §3), per-user dismissal, and the
 * `Need a prompt?` recovery link.
 *
 * Content precedence:
 *   1. `children` present  → transcript content (live/seekable — later slices fill these in).
 *   2. `chosenPrompt`      → the taken prompt, shown IN PLACE inside the same frame (stays through
 *                            recording; re-rollable) — replaces the offer without moving the card.
 *   3. offer not dismissed → the prompt offer overlay.
 *   4. dismissed + empty   → the plain empty state; the header carries `Need a prompt?` to recover it.
 */
export interface TranscriptCardProps {
    /** Whether the prompt offer has been dismissed for this user (from usePromptOfferDismissed). */
    offerDismissed: boolean;
    /** Dismiss the offer (`✕`) — persists per user. */
    onDismissOffer: () => void;
    /** Recover the offer (`Need a prompt?`). */
    onRestoreOffer: () => void;
    /** Take a generated prompt. */
    onTakePrompt: () => void;
    /** Read a worked sample. */
    onReadSample: () => void;
    /** The prompt the user took, shown in place; when set the offer is replaced by this. */
    chosenPrompt?: string | null;
    /** Re-roll the taken prompt (↻). */
    onRerollPrompt?: () => void;
    /** Live/after header meta beside the title (e.g. `184 words · 2.6 fillers/min`). */
    headerMeta?: React.ReactNode;
    /** Footer strip below the body (e.g. the live note, or the after stats strip). */
    footer?: React.ReactNode;
    /**
     * #1231 R1: recording → show a "● Live" chip in the header. The transcript is being written + corrected
     * in real time; the chip (plus the settling-text treatment in LiveTranscript) tells the user the live
     * edge is intentionally in flux, so re-writes read as expected, not a glitch.
     */
    live?: boolean;
    /**
     * #1231 R1: post-Stop decode in progress → show a distinct finalizing banner at the top of the card so
     * the multi-second wait is never silent. `isPrivate` picks the local-processing wording.
     */
    finalizing?: boolean;
    isPrivate?: boolean;
    /** Transcript content for the live/after states; when present it wins over the offer. */
    children?: React.ReactNode;
}

const OrangeTick: React.FC = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
        <path d="M3 8.5l3 3 7-7" fill="none" stroke="#d98a1f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

export const TranscriptCard: React.FC<TranscriptCardProps> = ({
    offerDismissed,
    onDismissOffer,
    onRestoreOffer,
    onTakePrompt,
    onReadSample,
    chosenPrompt,
    onRerollPrompt,
    headerMeta,
    footer,
    live,
    finalizing,
    isPrivate,
    children,
}) => {
    const hasContent = React.Children.count(children) > 0;
    const hasChosenPrompt = !hasContent && !!chosenPrompt;
    const showingOffer = !hasContent && !hasChosenPrompt && !offerDismissed;
    const showingEmpty = !hasContent && !hasChosenPrompt && offerDismissed;

    return (
        <div
            className="flex h-full flex-col rounded-xl border border-[#dbe2ec] bg-white p-4"
            data-testid="transcript-card"
            data-transcript-state={hasContent ? 'content' : hasChosenPrompt ? 'prompt' : showingOffer ? 'offer' : 'empty'}
        >
            {/* Header — orange tick + title left; recovery link + dismiss right. Present in every state. */}
            <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <OrangeTick />
                    <h2 className="text-[14px] font-extrabold text-[#1f2733]">Live Transcript</h2>
                    {live && (
                        <span
                            className="flex items-center gap-1 rounded-full bg-[#fdf3e2] px-2 py-0.5 text-[11px] font-bold text-[#a8571f]"
                            data-testid="transcript-live-indicator"
                            aria-label="Live — transcript updates as you speak"
                        >
                            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#d98a1f]" aria-hidden="true" />
                            Live
                        </span>
                    )}
                    {headerMeta && (
                        <span className="text-[12px] font-semibold text-[#414b5c]" data-testid="transcript-header-meta">
                            {headerMeta}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    {showingEmpty && (
                        <button
                            type="button"
                            onClick={onRestoreOffer}
                            data-testid="transcript-need-prompt"
                            className="text-[12px] font-bold text-[#0d7d74] underline-offset-2 hover:underline"
                        >
                            Need a prompt?
                        </button>
                    )}
                    {showingOffer && (
                        <button
                            type="button"
                            onClick={onDismissOffer}
                            data-testid="transcript-dismiss-offer"
                            aria-label="Dismiss prompt offer"
                            className="text-[16px] leading-none text-[#414b5c] hover:text-[#1f2733]"
                        >
                            ✕
                        </button>
                    )}
                </div>
            </div>

            {/* #1231 R1: finalizing banner — a distinct strip (not woven into the transcript) so the post-Stop
                decode wait is clearly signalled and never mistaken for transcript content. */}
            {finalizing && (
                <div
                    className="mb-3 flex items-center gap-2 rounded-lg bg-[#fdf3e2] px-3 py-2 text-[13px] font-semibold text-[#a8571f]"
                    role="status"
                    data-testid="transcript-finalizing-banner"
                >
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#d98a1f]" aria-hidden="true" />
                    {isPrivate ? 'Finalizing your transcript locally…' : 'Finalizing your transcript…'}
                </div>
            )}

            {/* Body */}
            {hasContent ? (
                <div className="min-h-0 flex-1 overflow-y-auto" data-testid="transcript-content">
                    {children}
                </div>
            ) : (
                <div
                    className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-[#c5cfdd] p-6"
                    data-testid="transcript-empty-frame"
                >
                    {hasChosenPrompt ? (
                        <div className="w-full max-w-md text-center" data-testid="transcript-chosen-prompt">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-[#5b21b6]">Your prompt</p>
                            <p className="mt-2 text-[17px] font-semibold leading-relaxed text-[#1f2733]">{chosenPrompt}</p>
                            {onRerollPrompt && (
                                <button
                                    type="button"
                                    onClick={onRerollPrompt}
                                    data-testid="transcript-reroll-prompt"
                                    aria-label="Get another prompt"
                                    className="mt-3 inline-flex items-center gap-1 text-[13px] font-bold text-[#0d7d74] hover:underline"
                                >
                                    ↻ Another
                                </button>
                            )}
                        </div>
                    ) : showingOffer ? (
                        <PromptOffer onPrompt={onTakePrompt} onSample={onReadSample} />
                    ) : (
                        <p className="text-[13px] text-[#414b5c]" data-testid="transcript-plain-empty">
                            Your words appear here as you speak.
                        </p>
                    )}
                </div>
            )}

            {footer && (
                <div className="mt-3 border-t border-[#eef2f7] pt-2 text-[12px] text-[#414b5c]" data-testid="transcript-footer">
                    {footer}
                </div>
            )}
        </div>
    );
};
