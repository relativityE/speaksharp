import React from 'react';

/**
 * #1222 slot B (before) — the prompt offer. This is the single most important instruction on the
 * before-state page, and per spec §3 it is an **overlay on the transcript's empty state — never its own
 * card**: no second white box, no border, no shadow. It borrows dead space; it never claims new space.
 * `TranscriptCard` renders it centred inside the dashed empty frame.
 *
 * The two actions are a **matched pair of equal weight** — two branches of the same choice — so one is
 * never a button and the other a link:
 *   • `Give me a prompt` — teal fill, white text.
 *   • `Read a sample`    — `#f5f0ff` fill, `#ddd0fa` border, `#5b21b6` text (the purple insight path).
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
            <p className="text-[18px] font-extrabold text-[#1f2733]">Not sure what to say?</p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-[#414b5c]">
                Take a prompt — it stays right here while you speak. Nothing on this panel is saved or scored.
            </p>

            {/* Matched pair: equal weight, side by side. */}
            <div className="mt-4 flex justify-center gap-3">
                <button
                    type="button"
                    onClick={onPrompt}
                    data-testid="prompt-offer-give"
                    className="rounded-lg bg-[#0d7d74] px-4 py-2 text-[14px] font-bold text-white transition-colors hover:bg-[#0a5f58]"
                >
                    Give me a prompt
                </button>
                <button
                    type="button"
                    onClick={onSample}
                    data-testid="prompt-offer-sample"
                    className="rounded-lg border border-[#ddd0fa] bg-[#f5f0ff] px-4 py-2 text-[14px] font-bold text-[#5b21b6] transition-colors hover:bg-[#ece2ff]"
                >
                    Read a sample
                </button>
            </div>

            <p className="mt-3 text-[12px] text-[#414b5c]">
                Or just press the mic — your words appear here.
            </p>
        </div>
    );
};
