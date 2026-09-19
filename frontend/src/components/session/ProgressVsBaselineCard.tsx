import React from 'react';

/**
 * G16 / SESSION_BEFORE_DELTA D1 — slot D in `before`: a real white card, always with a body.
 *
 * The shipped rail rendered a bare `See your progress` link straight on the slate page ground for every
 * returning user — every other slot was a card, so the rail read as a failed render. This card has exactly
 * two bodies and never a heading alone:
 *
 *   - numeric: the comparison value, its unit and the window it was measured over;
 *   - no comparable number: one plain line, a hairline, and when comparisons begin.
 *
 * A failed or absent progress read renders the no-number body (D1), never nothing. The no-number headline is
 * chosen from a FACT, not a guess: `First session …` only when the user genuinely has no saved sessions — a
 * returning user without a comparable number is not on their first session, and telling them so would be
 * false. Designer (2026-09-19): every other no-number case — including a failed read — says `No comparable
 * run yet.`, and the second line explains why exactly once.
 */
export interface ProgressVsBaselineValue {
    /** Display value, sign included, e.g. `−24%`. */
    value: string;
    /** Unit label beside the value, e.g. `fillers`. */
    unit: string;
    /** Colour follows the direction: improvement is the status green, a regression the signature amber. */
    direction: 'improvement' | 'regression';
    /** The comparison window, e.g. `Against your 6 Jul baseline, last 5 runs.` */
    windowLabel: string;
}

export interface ProgressVsBaselineCardProps {
    /** The resolved comparison, or null when there is no comparable number (including a failed read). */
    progress: ProgressVsBaselineValue | null;
    /** True only when the user has no saved sessions at all. */
    isFirstSession: boolean;
}

export const ProgressVsBaselineCard: React.FC<ProgressVsBaselineCardProps> = ({ progress, isFirstSession }) => (
    <section
        className="flex flex-1 flex-col rounded-[14px] border border-neutral-border-strong bg-neutral-page px-5 pb-5 pt-[18px]"
        data-testid="progress-vs-baseline"
        data-progress-body={progress ? 'numeric' : 'no-history'}
        aria-label="Progress vs baseline"
    >
        <p className="text-[12px] font-extrabold uppercase tracking-[0.09em] text-neutral-secondary">Progress vs baseline</p>
        {progress ? (
            <div className="mt-3.5" data-testid="progress-vs-baseline-numeric">
                <p className="flex items-baseline gap-2">
                    <span
                        className={`text-[40px] font-extrabold leading-none tracking-[-0.035em] [font-variant-numeric:tabular-nums] ${progress.direction === 'improvement' ? 'text-status' : 'text-signature-text'}`}
                        data-testid="progress-vs-baseline-value"
                    >
                        {progress.value}
                    </span>
                    <span className="text-[14px] font-bold text-neutral-secondary">{progress.unit}</span>
                </p>
                <p className="mt-2 text-[13px] font-semibold text-neutral-muted">{progress.windowLabel}</p>
            </div>
        ) : (
            <div className="mt-3.5" data-testid="progress-vs-baseline-empty">
                <p className="text-[15px] font-bold leading-snug text-neutral-body" data-testid="progress-vs-baseline-line">
                    {isFirstSession ? 'First session — this run becomes your baseline.' : 'No comparable run yet.'}
                </p>
                <p className="mt-3 border-t border-neutral-border-soft pt-3 text-[13px] font-semibold text-neutral-muted">
                    Comparisons start once you have two runs of a similar length.
                </p>
            </div>
        )}
    </section>
);
