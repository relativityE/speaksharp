import React from 'react';

/**
 * #1222 slot B (before) — the prompt offer. This is the single most important instruction on the
 * before-state page, and per spec §3 it is an **overlay on the transcript's empty state — never its own
 * card**: no second white box, no border, no shadow. It borrows dead space; it never claims new space.
 * `TranscriptCard` renders it centred inside the dashed empty frame.
 *
 * The two actions are a **matched pair of equal weight** — two branches of the same choice — so one is
 * never a button and the other a link:
 *   • `Give me a prompt` — signature fill, ink text (the one yellow action in this state).
 *   • `Read a sample`    — white fill, `neutral-border-strong` border, `neutral-heading` text.
 *
 * Design Correction Brief G3: the sentence that used to sit under the heading ("Take a prompt — it stays
 * right here while you speak. Nothing on this panel is saved or scored.") described the panel's own
 * mechanics to a user about to watch them happen. It is deleted, not shortened.
 */
export interface PromptOfferProps {
    /** Take a generated speaking prompt (stays visible through recording). */
    onPrompt: () => void;
    /** Read a worked sample aloud (the purple insight path). */
    onSample: () => void;
}

export const PromptOffer: React.FC<PromptOfferProps> = ({ onPrompt, onSample }) => {
    return (
        <div className="mx-auto max-w-md text-center" data-testid="prompt-offer">
            <p className="text-[16px] font-extrabold text-neutral-body">Not sure what to say?</p>

            {/* Matched pair: equal weight, side by side. */}
            <div className="mt-[14px] flex justify-center gap-3">
                <button
                    type="button"
                    onClick={onPrompt}
                    data-testid="prompt-offer-give"
                    className="rounded-lg bg-signature px-4 py-2 text-[14px] font-bold text-ink transition-colors hover:brightness-95"
                >
                    Give me a prompt
                </button>
                <button
                    type="button"
                    onClick={onSample}
                    data-testid="prompt-offer-sample"
                    className="rounded-lg border border-neutral-border-strong bg-white px-4 py-2 text-[14px] font-bold text-neutral-body transition-colors hover:bg-neutral-band"
                >
                    Read a sample
                </button>
            </div>

            <p className="mt-[14px] text-[13px] font-semibold text-neutral-muted">
                Or just press the mic — your words appear here.
            </p>
        </div>
    );
};
