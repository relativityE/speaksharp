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
    /** Whether the prompt offer has been dismissed for this user (a persisted choice from before the
     *  panel stopped being dismissible). Such a user keeps the `Need a prompt?` recovery link. */
    offerDismissed: boolean;
    /**
     * @deprecated Design Correction Brief S-4: the transcript is the product and is not dismissible, so no
     * `✕` renders. Kept on the interface only so existing callers compile; it is never invoked.
     */
    onDismissOffer?: () => void;
    /** Recover the offer (`Need a prompt?`). */
    onRestoreOffer: () => void;
    /** Take a generated prompt. */
    onTakePrompt: () => void;
    /** Read a worked sample. */
    onReadSample: () => void;
    /** The prompt the user took, shown in place; when set the offer is replaced by this. */
    chosenPrompt?: string | null;
    /** #1116 — for a read-aloud SAMPLE, its title + attribution (author/source) so the reader gets full
     *  credit and can identify the passage. Absent for the generated speaking prompts. */
    chosenPromptTitle?: string | null;
    chosenPromptAttribution?: string | null;
    /** Re-roll the taken prompt (↻). */
    onRerollPrompt?: () => void;
    /**
     * #1046 Focus Points: suppress the whole "Not sure what to say?" prompt/sample apparatus — the offer,
     * the `Need a prompt?` recovery link, everything. A Focus Points speaker already knows what to say (their
     * declared points), so the Open-Floor prompt concept doesn't belong on that product. Defaults to shown.
     */
    hidePromptOffer?: boolean;
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
    /**
     * #891 / PO 2026-08-10: honest finalize-time estimate (seconds) for the post-Stop decode, shown in the
     * "Finalizing…" banner as a live "~Ns" countdown so the wait is never a silent unknown. Null → no number.
     */
    finalizeEstimateSeconds?: number | null;
    /** Transcript content for the live/after states; when present it wins over the offer. */
    children?: React.ReactNode;
    /** A text-link action in the header (S-4: `Add your filler words` moved here from its own strip). */
    headerAction?: React.ReactNode;
    /**
     * S-13 — after the run the transcript is REFERENCE, not the subject. Capped, it cannot push the rail's
     * counts off screen and re-create the original buried-result bug one level down.
     *
     * The cap is CSS ONLY: the whole transcript stays in the DOM. Live specs and the benchmark harness read
     * `transcript-content` by `textContent`, so truncating the text itself would silently change what they
     * measure. `Read full transcript` lifts the cap in place.
     */
    capped?: boolean;
    /**
     * G16 / SESSION_BEFORE_DELTA D2+D3 — the `before` layout. The header is the `LIVE TRANSCRIPT` eyebrow with
     * the word count right-aligned (no tick, no glyph, no link), and the empty-state box is compact so the
     * transcript and the rail end level. `during` and `after` keep their layout (the delta changes neither).
     */
    beforeLayout?: boolean;
}

const OrangeTick: React.FC = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
        <path d="M3 8.5l3 3 7-7" fill="none" stroke="var(--brand-signature)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

export const TranscriptCard: React.FC<TranscriptCardProps> = ({
    offerDismissed,
    onRestoreOffer,
    onTakePrompt,
    onReadSample,
    chosenPrompt,
    chosenPromptTitle,
    chosenPromptAttribution,
    onRerollPrompt,
    headerMeta,
    footer,
    live,
    finalizing,
    isPrivate,
    finalizeEstimateSeconds,
    hidePromptOffer,
    children,
    headerAction,
    capped,
    beforeLayout,
}) => {
    const [expanded, setExpanded] = React.useState(false);
    const isCapped = Boolean(capped) && !expanded;
    // "Read full transcript" is offered only when the cap actually clips something. A short session fits
    // under 280px, and a button that reveals nothing is a no-op dressed as an action.
    const contentRef = React.useRef<HTMLDivElement | null>(null);
    const [overflows, setOverflows] = React.useState(false);
    React.useLayoutEffect(() => {
        const node = contentRef.current;
        if (!node || !isCapped) return;
        const measure = () => setOverflows(node.scrollHeight > node.clientHeight + 1);
        measure();
        if (typeof ResizeObserver !== 'function') return;
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, [isCapped, children]);
    // #891 — live countdown for the "Finalizing…" wait. Seed from the estimate when finalizing begins, then
    // tick down once a second (floored at 1s so it never shows 0 or negative while the decode is still going).
    const [finalizeRemaining, setFinalizeRemaining] = React.useState<number | null>(null);
    React.useEffect(() => {
        if (finalizing && finalizeEstimateSeconds && finalizeEstimateSeconds > 0) {
            setFinalizeRemaining(finalizeEstimateSeconds);
            const t = setInterval(() => {
                setFinalizeRemaining((r) => (r == null ? null : Math.max(1, r - 1)));
            }, 1000);
            return () => clearInterval(t);
        }
        setFinalizeRemaining(null);
    }, [finalizing, finalizeEstimateSeconds]);

    const hasContent = React.Children.count(children) > 0;
    const hasChosenPrompt = !hasContent && !!chosenPrompt;
    // Focus Points suppresses the offer entirely: it never shows, and the empty frame falls straight to the
    // plain "your words appear here" state with no `Need a prompt?` recovery affordance.
    const showingOffer = !hasContent && !hasChosenPrompt && !offerDismissed && !hidePromptOffer;
    const showingEmpty = !hasContent && !hasChosenPrompt && (offerDismissed || Boolean(hidePromptOffer));

    return (
        <div
            className="flex h-full flex-col rounded-xl border border-neutral-border bg-white p-4"
            data-testid="transcript-card"
            data-transcript-state={hasContent ? 'content' : hasChosenPrompt ? 'prompt' : showingOffer ? 'offer' : 'empty'}
        >
            {/* Header — tick + title left; recovery link and header action right. Present in every state.
                S-4: no `✕` — the transcript is the product, not a dismissible panel. */}
            {beforeLayout ? (
                <div className="mb-3 flex items-center justify-between" data-testid="transcript-before-header">
                    <h2 className="text-[12px] font-extrabold uppercase tracking-[0.09em] text-neutral-secondary">Live transcript</h2>
                    {headerMeta && (
                        <span className="text-[12px] font-bold text-neutral-muted" data-testid="transcript-header-meta">
                            {headerMeta}
                        </span>
                    )}
                </div>
            ) : (
            <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <OrangeTick />
                    <h2 className="text-[14px] font-extrabold text-neutral-body">Live Transcript</h2>
                    {headerMeta && (
                        <span className="text-[12px] font-semibold text-neutral-secondary" data-testid="transcript-header-meta">
                            {headerMeta}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    {showingEmpty && !hidePromptOffer && (
                        <button
                            type="button"
                            onClick={onRestoreOffer}
                            data-testid="transcript-need-prompt"
                            className="text-[12px] font-bold text-signature-text underline-offset-2 hover:underline"
                        >
                            Need a prompt?
                        </button>
                    )}
                    {headerAction}
                </div>
            </div>
            )}

            {/* #1231 R1 / PO 2026-08-10: ONE prominent status banner at the top of the transcript, so the
                user is never judging the ROUGH live draft as the final result. While recording it reads
                "Draft text in progress…" and states plainly that the transcript is finalized on Stop (the
                finalized decode is markedly cleaner — "night and day" per the PO). The instant Stop is clicked
                it flips IN PLACE to "Finalizing…" so the post-Stop decode wait is never silent. Mutually
                exclusive; finalizing wins (it is the post-Stop state). */}
            {(finalizing || live) && (
                <div
                    className="mb-3 flex items-center gap-2 rounded-lg bg-signature-ground px-3 py-2 text-[13px] font-semibold text-signature-text"
                    role="status"
                    data-testid={finalizing ? 'transcript-finalizing-banner' : 'transcript-live-indicator'}
                    aria-label={finalizing ? undefined : 'Draft text in progress — the transcript is finalized when you stop'}
                >
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-signature" aria-hidden="true" />
                    {finalizing
                        ? `${isPrivate ? 'Finalizing your transcript locally…' : 'Finalizing your transcript…'}${finalizeRemaining ? ` ~${finalizeRemaining}s` : ''}`
                        : 'Draft text in progress — finalized when you stop'}
                </div>
            )}

            {/* Body */}
            {hasContent ? (
                <>
                    <div
                        ref={contentRef}
                        className={`min-h-0 flex-1 overflow-y-auto${isCapped ? ' max-h-[280px]' : ''}`}
                        data-testid="transcript-content"
                        data-transcript-capped={isCapped ? 'true' : 'false'}
                    >
                        {children}
                    </div>
                    {isCapped && overflows && (
                        <button
                            type="button"
                            onClick={() => setExpanded(true)}
                            className="mt-3 self-start text-[14px] font-extrabold text-signature-text underline-offset-2 hover:underline"
                            data-testid="read-full-transcript"
                        >
                            Read full transcript
                        </button>
                    )}
                </>
            ) : (
                <div
                    className={`flex flex-1 items-center justify-center rounded-lg border border-dashed border-neutral-border-strong ${beforeLayout ? 'px-5 py-[22px]' : 'p-6'}`}
                    data-testid="transcript-empty-frame"
                >
                    {hasChosenPrompt ? (
                        <div className="w-full max-w-md text-center" data-testid="transcript-chosen-prompt">
                            {/* A read-aloud sample carries its own title (the label) + attribution (credit); a
                                generated speaking prompt has neither, so it stays the generic "Your prompt". */}
                            <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-secondary" data-testid="chosen-prompt-title">
                                {chosenPromptTitle || 'Your prompt'}
                            </p>
                            <p className="mt-2 text-[17px] font-semibold leading-relaxed text-neutral-body">{chosenPrompt}</p>
                            {chosenPromptAttribution && (
                                <p className="mt-2 text-[12px] italic text-neutral-secondary" data-testid="chosen-prompt-attribution">
                                    — {chosenPromptAttribution}
                                </p>
                            )}
                            {onRerollPrompt && (
                                <button
                                    type="button"
                                    onClick={onRerollPrompt}
                                    data-testid="transcript-reroll-prompt"
                                    aria-label="Get another prompt"
                                    className="mt-3 inline-flex items-center gap-1 text-[13px] font-bold text-signature-text hover:underline"
                                >
                                    ↻ Another
                                </button>
                            )}
                        </div>
                    ) : showingOffer ? (
                        <PromptOffer onPrompt={onTakePrompt} onSample={onReadSample} />
                    ) : hidePromptOffer ? (
                        // Focus Points empty state: ONE line (Design Correction Brief F-4). The second line
                        // ("Each point on the right ticks green…") narrated what the user was about to watch
                        // happen. The points list is not duplicated here — the rail already holds it.
                        <p className="max-w-md text-center text-[13px] text-neutral-secondary" data-testid="transcript-plain-empty">
                            Your words appear here as you speak.
                        </p>
                    ) : (
                        <p className="text-[13px] text-neutral-secondary" data-testid="transcript-plain-empty">
                            Your words appear here as you speak.
                        </p>
                    )}
                </div>
            )}

            {footer && (
                <div className="mt-3 border-t border-neutral-border-soft pt-2 text-[12px] text-neutral-secondary" data-testid="transcript-footer">
                    {footer}
                </div>
            )}
        </div>
    );
};
