import React from 'react';

/**
 * #1258 G20 — THE saved review pair, one component for both places and both products.
 *
 * The Session page after Stop and the Analytics session detail render the same saved pair through this component,
 * so the same session reads word for word the same in both. Only the evidence source differs by product (see
 * `sessionEvidence.ts`). It sits on the ink review card.
 *
 * Headings, not styled paragraphs: the pair is two labelled sections, and the live journeys locate each by its
 * heading role before reading the sentence beneath it.
 */
export const PracticeLoopReviewPair: React.FC<{
    whatWorked: string;
    whatToTryNext: string;
    /** "From this session" lines — measurements beside the advice, never the reason the AI gave it. */
    evidence?: readonly string[];
    /** The ONE practice action, when this surface owns it. */
    action?: React.ReactNode;
    testId?: string;
}> = ({ whatWorked, whatToTryNext, evidence = [], action, testId }) => (
    <div className="flex flex-col gap-3" data-testid={testId}>
        <div className="rounded-xl bg-ink-raised px-[15px] py-3">
            <h4 className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-muted">What went well</h4>
            <p className="mt-1.5 text-[15px] font-semibold leading-snug text-ink-text" data-testid="review-what-went-well">{whatWorked}</p>
        </div>
        {/* The next action, in the signature block — the one imperative sentence, and the prominent one. */}
        <div className="rounded-xl bg-signature px-5 py-[18px]">
            <h4 className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-signature-text">Try this next run</h4>
            <p className="mt-1.5 text-[16px] font-extrabold leading-[1.48] text-ink" data-testid="review-try-next">{whatToTryNext}</p>
            {evidence.length > 0 && (
                <div className="mt-4 border-t border-ink/15 pt-3" data-testid="review-evidence">
                    <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-signature-text">From this session</p>
                    {evidence.map((line) => (
                        <p key={line} className="mt-1 text-[14px] font-bold leading-snug text-ink">{line}</p>
                    ))}
                </div>
            )}
            {action && <div className="mt-4">{action}</div>}
        </div>
    </div>
);

export default PracticeLoopReviewPair;
