import React from 'react';

/**
 * #1222 slot D (after) — the verdict (spec §5). Exactly three things, never more:
 *   1. ONE verdict line (21px/800) — never a paragraph.
 *   2. ONE fix, in a purple-tinted box labelled `FIX THIS NEXT TIME`, quoted from the transcript with its
 *      occurrence count.
 *   3. TWO actions — `Practice this again` (teal, reuses the same prompt) + `See all sessions` (text link).
 *
 * No confetti, no score out of 100 — the motivator is the delta against the user's own past (slot C).
 */
export interface SessionVerdictProps {
    /**
     * One line, e.g. "Your cleanest session yet."
     *
     * #1422 — OPTIONAL, because the coaching prose it carried is RETIRED (#1306). When there is
     * nothing truthful to say, the card renders its actions and says nothing. It previously fell back
     * to "Session review not requested." and rendered that above the real generated 1+1 review, so the
     * screen contradicted itself: a verdict claiming no review was requested, directly above the
     * review.
     */
    verdictLine?: string | null;
    /** The single fix — quoted from the transcript with its count. Optional for the same reason. */
    fix?: string | null;
    onPracticeAgain: () => void;
    onSeeAllSessions: () => void;
}

export const SessionVerdict: React.FC<SessionVerdictProps> = ({ verdictLine, fix, onPracticeAgain, onSeeAllSessions }) => {
    // Rendered ONLY when there is something true to render. The actions below are unconditional:
    // `Practice this again` is the only desktop control wired to start the next take.
    const line = verdictLine?.trim() || null;
    const fixLine = fix?.trim() || null;
    return (
        <div data-testid="session-verdict">
            {line && (
                <p className="text-[21px] font-extrabold leading-tight text-neutral-body" data-testid="verdict-line">
                    {line}
                </p>
            )}

            {fixLine && (
                <div
                    className="mt-3 rounded-lg border border-focus-points-border bg-focus-points-ground p-3"
                    data-testid="verdict-fix"
                >
                    <p className="text-[11px] font-bold uppercase tracking-wide text-focus-points-strong">Fix this next time</p>
                    <p className="mt-1 text-[14px] leading-relaxed text-neutral-body">{fixLine}</p>
                </div>
            )}

            <div className="mt-4 flex items-center gap-4">
                <button
                    type="button"
                    onClick={onPracticeAgain}
                    data-testid="verdict-practice-again"
                    className="rounded-lg bg-signature px-4 py-2 text-[14px] font-bold text-ink hover:brightness-95"
                >
                    Practice this again
                </button>
                <button
                    type="button"
                    onClick={onSeeAllSessions}
                    data-testid="verdict-see-all"
                    className="text-[13px] font-bold text-signature-text hover:underline"
                >
                    See all sessions
                </button>
            </div>
        </div>
    );
};
