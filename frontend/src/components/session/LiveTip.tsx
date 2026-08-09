import React from 'react';

/**
 * #1222 slot D (during) — ONE live coaching tip (spec §4). Never a stack. Three parts:
 *   1. an imperative headline (20px/800) — e.g. "Pause instead of 'um'."
 *   2. one sentence of evidence naming the count and the window — "You've used it 4 times in 30 seconds."
 *   3. a green-tinted strip for what is going RIGHT — "Pace 138 wpm — right in your range."
 *
 * The 8-second minimum hold is enforced upstream by `useHeldTip`; this component only renders the tip it
 * is given.
 */
export interface LiveTipData {
    /** Stable identity — the hold logic swaps only when this changes. */
    id: string;
    headline: string;
    evidence: string;
    /** Optional "going right" note; shown in the green strip when present. */
    goingRight?: string;
}

export const LiveTip: React.FC<{ tip: LiveTipData }> = ({ tip }) => {
    return (
        <div data-testid="live-tip" data-tip-id={tip.id}>
            <p className="text-[20px] font-extrabold leading-tight text-[#1f2733]" data-testid="live-tip-headline">
                {tip.headline}
            </p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-[#414b5c]" data-testid="live-tip-evidence">
                {tip.evidence}
            </p>
            {tip.goingRight && (
                <p
                    className="mt-3 rounded-lg bg-[#e7f5ee] px-3 py-2 text-[13px] font-semibold text-[#146b4a]"
                    data-testid="live-tip-going-right"
                >
                    {tip.goingRight}
                </p>
            )}
        </div>
    );
};
