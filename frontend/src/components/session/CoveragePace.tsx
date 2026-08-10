import React from 'react';
import { computePaceStats, fmtDuration } from '@/utils/focusPace';

/**
 * #1046 G6/G7 §2 — Slot C, "Coverage & pace". Supersedes the old coverage-only card (no pips).
 *
 * One card answering FP's question at a glance (the number a user catches in peripheral vision) plus the
 * pace context: the running average PER POINT (the dial) and the projected total (its consequence) against
 * the guide. Hard rules enforced here:
 *   - **Never renders in `before`** — the parent must not mount it there (a `0/total` scoreboard says only
 *     "you haven't started").
 *   - **Never a countdown / remaining time.** Only the guide total, the projection, the per-point average.
 *   - No guide → the pace half vanishes entirely; the card is the count alone.
 *   - Zero points covered → `— /point`, no bar fill, no projection line. Never `∞`.
 *   - The nudge lives INSIDE this card (during only), silent unless the parent passes one.
 */
export interface CoveragePaceProps {
    covered: number;
    total: number;
    /** Elapsed while recording (during) or the final duration (after). */
    elapsedSec: number;
    /** Guide seconds/point; null = skipped → the whole pace half is absent. */
    guideSecPerPoint: number | null;
    sessionState: 'during' | 'after';
    /** The live nudge from the parent's nudge engine; null = silent (during only). */
    nudge?: string | null;
}

export const CoveragePace: React.FC<CoveragePaceProps> = ({ covered, total, elapsedSec, guideSecPerPoint, sessionState, nudge }) => {
    const { pacePerPointSec, guideTotalSec, projectionSec, overGuide, barFraction } =
        computePaceStats({ elapsedSec, coveredCount: covered, totalPoints: total, guideSecPerPoint });
    const hasGuide = guideTotalSec != null;
    const countColor = covered > 0 ? '#146b4a' : '#8b95a5';
    const overColor = overGuide ? '#8a5510' : '#8b95a5';

    return (
        <section
            data-testid="coverage-pace"
            aria-label="Coverage and pace"
            className="flex flex-col rounded-2xl border border-[hsl(var(--border-strong))] bg-card p-5"
        >
            <p className="text-[12px] font-extrabold uppercase tracking-wide text-[#414b5c]">Coverage &amp; pace</p>

            <div className="mt-3 flex items-end justify-between gap-3.5">
                {/* Left — the glanceable count. */}
                <div className="flex items-baseline gap-2.5" data-testid="coverage-pace-count">
                    <span className="text-[40px] font-extrabold leading-none tracking-[-0.035em]" style={{ color: countColor }}>
                        {covered}<span className="text-[26px] text-[#86a597]">/{total}</span>
                    </span>
                    <span className="text-[14px] font-bold leading-tight text-[#414b5c]">points<br />covered</span>
                </div>

                {/* Right — pace per point (the dial). Absent entirely when no guide is set. */}
                {hasGuide && (
                    <div className="text-right" data-testid="coverage-pace-perpoint">
                        <div className="text-[24px] font-extrabold leading-none tracking-[-0.028em] tabular-nums" style={{ color: overGuide ? '#8a5510' : '#2b3446' }}>
                            {pacePerPointSec != null ? fmtDuration(pacePerPointSec) : '—'}
                            <span className="text-[15px] font-bold" style={{ color: overGuide ? '#b1946a' : '#8b95a5' }}> /point</span>
                        </div>
                        <div className="mt-[5px] text-[12px] font-bold text-[#8b95a5]">current pace</div>
                    </div>
                )}
            </div>

            {/* Pace bar + projection line — only when a guide is set. */}
            {hasGuide && (
                <div className="mt-4">
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#eef1f6]" data-testid="coverage-pace-bar">
                        <div
                            className="h-full rounded-full"
                            style={{ width: `${(barFraction ?? 0) * 100}%`, backgroundColor: overGuide ? '#e8c48a' : '#c7d0dd' }}
                        />
                    </div>
                    {/* during: guide vs projection ("at this pace"); after: guide vs actual. Never a countdown. */}
                    {(sessionState === 'after' || projectionSec != null) && (
                        <div className="mt-[9px] flex items-center justify-between gap-2.5 text-[12px] font-bold" data-testid="coverage-pace-projection">
                            <span className="text-[#8b95a5]">{fmtDuration(guideTotalSec!)} guide</span>
                            <span style={{ color: overColor }}>
                                {sessionState === 'after'
                                    ? `${fmtDuration(elapsedSec)} actual`
                                    : `${fmtDuration(projectionSec!)} at this pace`}
                            </span>
                        </div>
                    )}
                </div>
            )}

            {/* The live nudge — during only, silent by default. A remark (#8a5510), never an alert. */}
            {sessionState === 'during' && nudge && (
                <div className="mt-[14px] border-t border-[#eef1f6] pt-[13px] text-[13px] font-semibold leading-snug text-[#8a5510]" data-testid="coverage-pace-nudge">
                    {nudge}
                </div>
            )}
        </section>
    );
};

export default CoveragePace;
