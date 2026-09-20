import React from 'react';
import type { ClarityMove } from '@/hooks/useClarityMove';

/**
 * G18 (Designer + PM, 2026-09-20) — slot D in `before`: a white card that always has a body, and states THE
 * MOVE between the two most recent comparable runs, in the unit the rest of the app already speaks:
 * `82% → 88%`. Clarity is already rendered as a percent in the analytics dashboard, the trend chart and the
 * comparison dialog, so a lone `+6` would introduce a unit no other screen uses, and a `+7.3%` percent-of-
 * previous would be a SECOND percent for a metric the app prints as `96%`.
 *
 * The arrow carries the Practice Loop — two runs and a direction — which a lone delta never does, and the
 * scale is visible, so nothing needs decoding. The delta number is deliberately absent: `+6` beside
 * `82% → 88%` is the same fact twice.
 *
 * `Clarity` is DEMOTED, not renamed: it stays the vocabulary of the session rows, the analytics table and the
 * export, and appears here as the hairline detail (`Fillers, errors, pace`) rather than as the headline.
 *
 * Five outcomes, two bodies (§6.1) — see `useClarityMove`:
 *   - a move: improved / declined / held steady (a real comparison under the 3-point significance threshold,
 *     shown but not celebrated — both numbers are on the card, so "why wasn't that an improvement" is
 *     answerable by looking);
 *   - no number: `First session — this run becomes your baseline.` with zero saved sessions,
 *     `No comparable run yet.` in every other case, including a restarted cohort and a failed read.
 */
export interface ClarityVsLastSessionCardProps {
    move: ClarityMove;
}

/*
 * The window line names the compared session BY DATE and makes no claim about adjacency (Designer,
 * 2026-09-20). Eligibility skips runs that fail a gate, so "your last session" can be false for a user who
 * recorded a short take in between; "last comparable session" is true but adds the kind of word this
 * revision exists to remove. The date is true in every case and checkable against the session list.
 */
const SUPPORT_LINE: Record<'improved' | 'declined' | 'held_steady', (date: string) => string> = {
    improved: (date) => `Clearer than your ${date} session.`,
    declined: (date) => `Less clear than your ${date} session.`,
    held_steady: (date) => `Holding steady since ${date}.`,
};

export const ClarityVsLastSessionCard: React.FC<ClarityVsLastSessionCardProps> = ({ move }) => (
    <section
        className="flex flex-1 flex-col rounded-[14px] border border-neutral-border-strong bg-neutral-page px-5 pb-5 pt-[18px]"
        data-testid="clarity-vs-last-session"
        data-progress-body={move.kind === 'move' ? 'numeric' : 'no-history'}
        data-progress-direction={move.kind === 'move' ? move.direction : undefined}
        aria-label="Your progress"
    >
        <p className="text-[12px] font-extrabold uppercase tracking-[0.09em] text-neutral-secondary">Your progress</p>
        {move.kind === 'move' ? (
            <div className="mt-3.5" data-testid="clarity-vs-last-session-numeric">
                <p
                    className="flex items-baseline gap-2 text-[34px] font-extrabold leading-none tracking-[-0.035em] [font-variant-numeric:tabular-nums]"
                    data-testid="clarity-vs-last-session-value"
                >
                    <span className="text-neutral-heading">{move.previousPercent}%</span>
                    <span aria-hidden="true" className="text-[22px] font-bold text-neutral-muted">→</span>
                    {/* Only the SECOND number takes the outcome colour: the move is what changed, not the past. */}
                    <span
                        className={
                            move.direction === 'improved'
                                ? 'text-status'
                                : move.direction === 'declined'
                                    ? 'text-signature-text'
                                    : 'text-neutral-heading'
                        }
                        data-testid="clarity-vs-last-session-current"
                    >
                        {move.currentPercent}%
                    </span>
                </p>
                <p className="mt-2 text-[13px] font-semibold text-neutral-muted" data-testid="clarity-vs-last-session-support">
                    {SUPPORT_LINE[move.direction](move.referenceDateLabel)}
                </p>
                {/* §6: the composition line sits ABOVE the card's foot hairline — what the score is made of,
                    stated once, without defining it. */}
                <p className="mt-3 border-b border-neutral-border-soft pb-3 text-[12px] font-semibold text-neutral-muted">
                    Fillers, errors, pace
                </p>
            </div>
        ) : (
            <div className="mt-3.5" data-testid="clarity-vs-last-session-empty">
                <p className="text-[15px] font-bold leading-snug text-neutral-body" data-testid="clarity-vs-last-session-line">
                    {move.kind === 'first-session'
                        ? 'First session — this run becomes your baseline.'
                        : 'No comparable run yet.'}
                </p>
                <p className="mt-3 border-t border-neutral-border-soft pt-3 text-[13px] font-semibold text-neutral-muted">
                    Comparisons start after your next full session.
                </p>
            </div>
        )}
    </section>
);
