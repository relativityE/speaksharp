import React from 'react';

/**
 * #1222 slot D (after) — the review, restructured for #1474 (G10) as the page's dominant result.
 *
 * G10 names what this surface contains, in this order:
 *   1. ONE direct session-specific insight (21px/800) — never a paragraph.
 *   2. Supporting transcript excerpts with timestamps, when the review supplies them.
 *   3. ONE prominent `Try this next run` prescription.
 *   4. The primary `Practice this again` action, in the brand accent.
 *   5. The secondary `See all sessions` action.
 *
 * It renders on the dark-ink coaching surface (see `CoachingCard`, after state), so every colour here is an
 * ink-role or signature-role token. No raw values: the token authority owns the palette.
 *
 * Nothing on this surface is ever fabricated. The insight, the excerpts and the prescription are each
 * rendered only when genuinely supplied; when they are absent the actions still render, because an action is
 * not a claim about the session. No confetti, no score out of 100 — the motivator is the delta against the
 * user's own past (slot C).
 */

/** One supporting excerpt: the user's own words, and where in the take they occurred. */
export interface VerdictExcerpt {
    /** The quoted span from the transcript. */
    text: string;
    /** Display timestamp for that span, e.g. `0:42`. Rendered verbatim — never computed here. */
    at: string;
}

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
    /** The single prescription — quoted from the transcript with its count. Optional for the same reason. */
    fix?: string | null;
    /**
     * #1474 G10 — supporting transcript excerpts with timestamps. Optional and never synthesised: the
     * section appears only when the review supplies real spans, so an absent excerpt set shows nothing
     * rather than an empty frame or invented quotes.
     */
    excerpts?: VerdictExcerpt[] | null;
    onPracticeAgain: () => void;
    onSeeAllSessions: () => void;
}

/** Shared focus treatment: visible on the dark surface, and never removed without a replacement. */
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature focus-visible:ring-offset-2 focus-visible:ring-offset-ink';

export const SessionVerdict: React.FC<SessionVerdictProps> = ({ verdictLine, fix, excerpts, onPracticeAgain, onSeeAllSessions }) => {
    const line = verdictLine?.trim() || null;
    const fixLine = fix?.trim() || null;
    const spans = (excerpts ?? []).filter((e) => e.text?.trim());

    return (
        <div data-testid="session-verdict">
            {line && (
                <p className="text-[21px] font-extrabold leading-tight text-white" data-testid="verdict-line">
                    {line}
                </p>
            )}

            {/* G10 item 2 — the evidence under the insight: the user's own words, with when they happened. */}
            {spans.length > 0 && (
                <ul className="mt-3 flex flex-col gap-2" data-testid="verdict-excerpts" aria-label="Supporting transcript excerpts">
                    {spans.map((span, i) => (
                        <li
                            key={`${span.at}-${i}`}
                            className="flex items-baseline gap-2.5 rounded-lg bg-ink-raised px-3 py-2"
                            data-testid="verdict-excerpt"
                        >
                            <span className="shrink-0 text-[12px] font-bold tabular-nums text-ink-muted" data-testid="verdict-excerpt-at">
                                {span.at}
                            </span>
                            <span className="text-[14px] leading-relaxed text-ink-text">{span.text}</span>
                        </li>
                    ))}
                </ul>
            )}

            {/* G10 item 3 — the prominent prescription, in the brand accent on the dark surface. */}
            {fixLine && (
                <div
                    className="mt-3 rounded-lg border border-signature bg-ink-raised p-3"
                    data-testid="verdict-fix"
                >
                    <p className="text-[11px] font-bold uppercase tracking-wide text-signature">Try this next run</p>
                    <p className="mt-1 text-[15px] font-semibold leading-relaxed text-ink-text">{fixLine}</p>
                </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-4">
                <button
                    type="button"
                    onClick={onPracticeAgain}
                    data-testid="verdict-practice-again"
                    className={`rounded-lg bg-signature px-4 py-2 text-[14px] font-bold text-ink hover:brightness-95 ${FOCUS}`}
                >
                    Practice this again
                </button>
                <button
                    type="button"
                    onClick={onSeeAllSessions}
                    data-testid="verdict-see-all"
                    className={`rounded text-[13px] font-bold text-ink-text hover:underline ${FOCUS}`}
                >
                    See all sessions
                </button>
            </div>
        </div>
    );
};
