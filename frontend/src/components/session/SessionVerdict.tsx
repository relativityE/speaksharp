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
    /** One line, e.g. "Your cleanest session yet." */
    verdictLine: string;
    /** The single fix — quoted from the transcript with its count. */
    fix: string;
    onPracticeAgain: () => void;
    onSeeAllSessions: () => void;
}

export const SessionVerdict: React.FC<SessionVerdictProps> = ({ verdictLine, fix, onPracticeAgain, onSeeAllSessions }) => {
    return (
        <div data-testid="session-verdict">
            <p className="text-[21px] font-extrabold leading-tight text-[#1f2733]" data-testid="verdict-line">
                {verdictLine}
            </p>

            <div
                className="mt-3 rounded-lg border border-[#e6dcfb] bg-[#f5f0ff] p-3"
                data-testid="verdict-fix"
            >
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#5b21b6]">Fix this next time</p>
                <p className="mt-1 text-[14px] leading-relaxed text-[#1f2733]">{fix}</p>
            </div>

            <div className="mt-4 flex items-center gap-4">
                <button
                    type="button"
                    onClick={onPracticeAgain}
                    data-testid="verdict-practice-again"
                    className="rounded-lg bg-[#0d7d74] px-4 py-2 text-[14px] font-bold text-white hover:bg-[#0a5f58]"
                >
                    Practice this again
                </button>
                <button
                    type="button"
                    onClick={onSeeAllSessions}
                    data-testid="verdict-see-all"
                    className="text-[13px] font-bold text-[#0d7d74] hover:underline"
                >
                    See all sessions
                </button>
            </div>
        </div>
    );
};
