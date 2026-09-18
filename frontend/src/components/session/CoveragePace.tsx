/**
 * #1254 — DETECTION LANGUAGE, NOT COVERAGE LANGUAGE.
 *
 * The engine behind these words is a conservative LOCAL KEYWORD MATCHER. "Covered" asserts the point was
 * addressed; "missed" asserts the speaker failed to address it. Neither is what was measured — the engine
 * can only report whether it DETECTED the point's language. A speaker who made the point in their own
 * words and got an amber "missed" pip was told they failed at something they did.
 *
 * So the surface says detected / not detected, which is exactly what the measurement supports.
 */
import React from 'react';
import { computePaceStats, coveragePlanSentence, fmtDuration } from '@/utils/focusPace';

/**
 * "Coverage & pace" — the top card of the Focus Points rail (slot D). No pips.
 *
 * During and after it answers Focus Points' question at a glance (the number a user catches in peripheral
 * vision) plus the pace context: the running average PER POINT (the dial) and the projected total (its
 * consequence) against the guide.
 *
 * **`before` states the plan, not a score** (Design Correction Brief F-2, G4). It used to open with
 * `0/3 points detected` — a scoreboard reading zero before there was anything to score, telling the user
 * they had failed at something they had not started. It now reads `3 points · about 3:00 at 1:00 per point`.
 * The counter appears once recording begins, where zero is a true reading of a run in progress.
 *
 * **The pace guide is said once** (F-3). `before` used to render it three ways at once — `1:00 /point`,
 * `pace guide`, and `3:00 guide` — as large numerals, which belong to live data rather than to a setting
 * typed a minute ago. It is now one sentence, with `Edit pace` as a text link.
 *
 * **The nudge no longer lives here** (F-1). It renders in slot B, on ink, where Open Mic's live coaching is,
 * so both products coach in the same place.
 *
 * Unchanged rules: never a countdown or remaining time; no guide → the pace half is absent; zero covered
 * during/after → `— /point` with no bar fill and no projection. Never `∞`.
 */
export interface CoveragePaceProps {
    covered: number;
    total: number;
    /** Elapsed while recording (during) or the final duration (after). Ignored in `before` (guide-only). */
    elapsedSec: number;
    /** Guide seconds/point; null = skipped → the whole pace half is absent. */
    guideSecPerPoint: number | null;
    sessionState: 'before' | 'during' | 'after';
    /** before only: reopen the set editor to change the pace. Absent → no `Edit pace` link. */
    onEditPace?: () => void;
}

export const CoveragePace: React.FC<CoveragePaceProps> = ({ covered, total, elapsedSec, guideSecPerPoint, sessionState, onEditPace }) => {
    const isBefore = sessionState === 'before';

    if (isBefore) {
        return (
            <section
                data-testid="coverage-pace"
                data-coverage-state="before"
                aria-label="Coverage and pace"
                className="flex flex-col rounded-2xl border border-neutral-border-strong bg-card p-5"
            >
                <p className="text-[12px] font-extrabold uppercase tracking-wide text-neutral-secondary">Coverage &amp; pace</p>
                <p className="mt-2 text-[15px] font-bold leading-snug text-neutral-body" data-testid="coverage-pace-plan">
                    {coveragePlanSentence(total, guideSecPerPoint)}
                </p>
                {onEditPace && (
                    <button
                        type="button"
                        onClick={onEditPace}
                        data-testid="coverage-pace-edit"
                        className="mt-2 self-start text-[13px] font-bold text-neutral-secondary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature-text focus-visible:ring-offset-2"
                    >
                        Edit pace
                    </button>
                )}
            </section>
        );
    }

    const { pacePerPointSec, guideTotalSec, projectionSec, overGuide, barFraction } =
        computePaceStats({ elapsedSec, coveredCount: covered, totalPoints: total, guideSecPerPoint });
    const hasGuide = guideTotalSec != null;
    const countColor = covered > 0 ? 'var(--brand-status)' : 'var(--brand-neutral-muted)';
    const overColor = overGuide ? 'var(--brand-signature-text)' : 'var(--brand-neutral-muted)';

    return (
        <section
            data-testid="coverage-pace"
            aria-label="Coverage and pace"
            className="flex flex-col rounded-2xl border border-[hsl(var(--border-strong))] bg-card p-5"
        >
            <p className="text-[12px] font-extrabold uppercase tracking-wide text-neutral-secondary">Coverage &amp; pace</p>

            <div className="mt-3 flex items-end justify-between gap-3.5">
                {/* Left — the glanceable count. The numerator is the dominant element; the total is smaller. */}
                <div className="flex items-baseline gap-2.5" data-testid="coverage-pace-count">
                    <span className="font-extrabold leading-none tracking-[-0.035em]" style={{ color: countColor }}>
                        <span data-testid="coverage-pace-covered" className="text-[40px]">{covered}</span><span data-testid="coverage-pace-total" className="text-[26px] text-neutral-muted">/{total}</span>
                    </span>
                    <span className="text-[14px] font-bold leading-tight text-neutral-secondary">points<br />detected</span>
                </div>

                {/* Right — the measured per-point dial. Absent entirely when no guide is set. */}
                {hasGuide && (
                    <div className="text-right" data-testid="coverage-pace-perpoint">
                        <div className="text-[24px] font-extrabold leading-none tracking-[-0.028em] tabular-nums" style={{ color: overGuide ? 'var(--brand-signature-text)' : 'var(--brand-neutral-body)' }}>
                            {pacePerPointSec != null ? fmtDuration(pacePerPointSec) : '—'}
                            <span className="text-[15px] font-bold" style={{ color: 'var(--brand-neutral-muted)' }}> /point</span>
                        </div>
                        <div className="mt-[5px] text-[12px] font-bold text-neutral-muted">current pace</div>
                    </div>
                )}
            </div>

            {/* Pace bar + projection line, when a guide is set. */}
            {hasGuide && (
                <div className="mt-4">
                    <div className="h-1.5 overflow-hidden rounded-full bg-neutral-border-soft" data-testid="coverage-pace-bar">
                        <div
                            className="h-full rounded-full"
                            style={{ width: `${(barFraction ?? 0) * 100}%`, backgroundColor: overGuide ? 'var(--brand-signature)' : 'var(--brand-neutral-border-strong)' }}
                        />
                    </div>
                    {/* during: guide vs projection ("at this pace"); after: guide vs actual. Never a countdown. */}
                    {(sessionState === 'after' || projectionSec != null) && (
                        <div className="mt-[9px] flex items-center justify-between gap-2.5 text-[12px] font-bold" data-testid="coverage-pace-projection">
                            <span className="text-neutral-muted">{fmtDuration(guideTotalSec!)} guide</span>
                            <span style={{ color: overColor }}>
                                {sessionState === 'after'
                                    ? `${fmtDuration(elapsedSec)} actual`
                                    : `${fmtDuration(projectionSec!)} at this pace`}
                            </span>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
};

export default CoveragePace;
