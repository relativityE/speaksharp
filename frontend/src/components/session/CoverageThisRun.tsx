import React from 'react';

/**
 * #1046 Focus Points — slot C, "Coverage this run" (spec §2).
 *
 * The Focus Points analogue of Open Mic's progress-vs-baseline card: same headline slot, same
 * big-number shape, but it answers THIS product's question — how many of this run's points landed. It is
 * SINGLE-SESSION by construction: no baseline, no delta, no trend. Three points is not a dataset, and a
 * session-over-session delivery % (Open Mic's metric) on a fresh point set is noise rendered in red.
 *
 * Pips: one per point. Grey = pending, green = covered, amber = missed (after only). The big number is
 * muted grey at zero and turns progress-green the moment anything is covered.
 */
export interface CoverageThisRunProps {
    covered: number;
    total: number;
    sessionState: 'before' | 'during' | 'after';
    /** Elapsed seconds — shown as "in 1:24" in the after state. */
    elapsedSeconds?: number;
}

function fmtClock(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const CoverageThisRun: React.FC<CoverageThisRunProps> = ({ covered, total, sessionState, elapsedSeconds }) => {
    const numberColor = covered > 0 ? '#146b4a' : '#8b95a5';
    const secondLine = sessionState === 'after' && elapsedSeconds != null ? `in ${fmtClock(elapsedSeconds)}` : 'so far';

    return (
        <section
            data-testid="coverage-this-run"
            aria-label="Coverage this run"
            className="flex flex-col rounded-2xl border border-[hsl(var(--border-strong))] bg-card p-5"
        >
            <p className="text-[12px] font-extrabold uppercase tracking-wide text-[#414b5c]">Coverage this run</p>

            <div className="mt-2 flex items-baseline gap-3">
                <p className="leading-none" data-testid="coverage-this-run-count">
                    <span className="text-[40px] font-extrabold" style={{ color: numberColor }}>{covered}</span>
                    <span className="text-[26px] font-extrabold" style={{ color: '#8b95a5' }}>/{total}</span>
                </p>
                <p className="text-[14px] font-bold leading-tight text-[#414b5c]">
                    points covered<br />{secondLine}
                </p>
            </div>

            {/* One pip per point. */}
            <div className="mt-4 flex gap-[7px]" data-testid="coverage-this-run-pips">
                {Array.from({ length: total }).map((_, i) => {
                    const isCovered = i < covered;
                    // In the after state, any point that never got covered reads as a "missed" amber pip.
                    const isMissed = sessionState === 'after' && !isCovered;
                    const bg = isCovered ? '#1f9d6b' : isMissed ? '#d98a1f' : '#dfe5ee';
                    return <span key={i} className="h-2 flex-1 rounded-full" style={{ backgroundColor: bg }} aria-hidden="true" />;
                })}
            </div>
        </section>
    );
};

export default CoverageThisRun;
