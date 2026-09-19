import React from 'react';

/**
 * G16 / SESSION_BEFORE_DELTA D1 (Option A, PM + Designer 2026-09-19) — slot D in `before`: a white card that
 * always has a body. The comparison is the SHIPPED Progress contract — the clarity-score change versus the
 * previous comparable session — so the eyebrow says so (`CLARITY VS LAST SESSION`); it no longer names a fixed
 * baseline the contract does not compare against.
 *
 * Exactly two bodies, never a heading alone:
 *   - numeric: the clarity change, its unit and the session it was measured against;
 *   - no number: one line — `First session — this run becomes your baseline.` only with zero saved sessions,
 *     `No comparable run yet.` in every other case (including a failed read) — then when comparisons begin.
 */
export interface ClarityVsLastSessionValue {
    /** Display value, sign included, e.g. `+6`. */
    value: string;
    /** Unit label beside the value, e.g. `clarity`. */
    unit: string;
    /** Colour follows the direction: improvement is the status green, a regression the signature amber. */
    direction: 'improvement' | 'regression';
    /** The comparison window, e.g. `Against your previous session, 14 Sep.` */
    windowLabel: string;
    /** Short date of the session compared against, e.g. `14 Sep` — also drives the page subtitle (D4). */
    referenceDateLabel: string;
}

export interface ClarityVsLastSessionCardProps {
    /** The resolved comparison, or null when there is no comparable number (including a failed read). */
    progress: ClarityVsLastSessionValue | null;
    /** True only when the user has no saved sessions at all. */
    isFirstSession: boolean;
}

export const ClarityVsLastSessionCard: React.FC<ClarityVsLastSessionCardProps> = ({ progress, isFirstSession }) => (
    <section
        className="flex flex-1 flex-col rounded-[14px] border border-neutral-border-strong bg-neutral-page px-5 pb-5 pt-[18px]"
        data-testid="clarity-vs-last-session"
        data-progress-body={progress ? 'numeric' : 'no-history'}
        aria-label="Clarity vs last session"
    >
        <p className="text-[12px] font-extrabold uppercase tracking-[0.09em] text-neutral-secondary">Clarity vs last session</p>
        {progress ? (
            <div className="mt-3.5" data-testid="clarity-vs-last-session-numeric">
                <p className="flex items-baseline gap-2">
                    <span
                        className={`text-[40px] font-extrabold leading-none tracking-[-0.035em] [font-variant-numeric:tabular-nums] ${progress.direction === 'improvement' ? 'text-status' : 'text-signature-text'}`}
                        data-testid="clarity-vs-last-session-value"
                    >
                        {progress.value}
                    </span>
                    <span className="text-[14px] font-bold text-neutral-secondary">{progress.unit}</span>
                </p>
                <p className="mt-2 text-[13px] font-semibold text-neutral-muted">{progress.windowLabel}</p>
            </div>
        ) : (
            <div className="mt-3.5" data-testid="clarity-vs-last-session-empty">
                <p className="text-[15px] font-bold leading-snug text-neutral-body" data-testid="clarity-vs-last-session-line">
                    {isFirstSession ? 'First session — this run becomes your baseline.' : 'No comparable run yet.'}
                </p>
                <p className="mt-3 border-t border-neutral-border-soft pt-3 text-[13px] font-semibold text-neutral-muted">
                    Comparisons start after your next full session.
                </p>
            </div>
        )}
    </section>
);
