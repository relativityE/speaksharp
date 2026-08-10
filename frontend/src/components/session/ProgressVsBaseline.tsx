import React from 'react';
import type { ProgressVsBaselineResult } from '@/utils/progressVsBaseline';

/**
 * #1222 slot C — Progress vs baseline. ONE data-driven component rendered in all three session states
 * (before / during / after); do not fork it per state. It shows the session-over-session progress as a
 * PERCENTAGE change in fillers/min vs. the user's baseline (session 1) — the retired-SpeakSharp-Score
 * replacement. Improvement is green and honest; a regression is reported in the same size/neutral tone,
 * never scolded. Values/wording come from `computeProgressVsBaseline` (§6); this owns presentation only.
 */
export interface ProgressVsBaselineProps {
    result: ProgressVsBaselineResult;
    sessionState: 'before' | 'during' | 'after';
    /**
     * 'filler' (default) — the single-signal card ("N% fewer fillers", "/min" units).
     * 'aggregate' — the #1206 composite: "N% better/worse than your baseline"; the footer numbers are the
     * composite "baseline signal" (0–100), not a per-minute rate.
     */
    mode?: 'filler' | 'aggregate';
}

const GREEN = '#146b4a';
const GREEN_BAR = '#1f9d6b';
const GREEN_MUTED_BAR = '#b7d8c8';
const REGRESS = '#a8321f';
const TRACK = '#e0e6ee';

// The right-hand footer label differs per state; the number does not move, only its meaning.
const CURRENT_LABEL: Record<ProgressVsBaselineProps['sessionState'], string> = {
    before: 'Last session',
    during: 'Now',
    after: 'Today',
};

// The headline context clause differs per state.
const DELTA_CONTEXT: Record<ProgressVsBaselineProps['sessionState'], string> = {
    before: 'than previous session',
    during: 'so far this session',
    after: 'than previous session',
};

/**
 * Render the delta-context line, emphasising a trailing session number when one is present (heavier weight +
 * tabular numerals). Contexts without a trailing number (e.g. "than last session", "so far this session")
 * render unchanged.
 */
function renderContext(context: string): React.ReactNode {
    const match = context.match(/^(.*?\s)(\d+)$/);
    if (!match) return context;
    return (
        <>
            {match[1]}
            <span className="font-extrabold tabular-nums text-[#0f1722]" data-testid="progress-baseline-session">{match[2]}</span>
        </>
    );
}

export const ProgressVsBaseline: React.FC<ProgressVsBaselineProps> = ({ result, sessionState, mode = 'filler' }) => {
    const { isBaseline, tooShort, currentRate, baselineRate, deltaPercent, direction, trend } = result;
    const isAgg = mode === 'aggregate';
    // Unit + noun differ by mode; filler mode is unchanged (existing tests are byte-identical).
    const unit = isAgg ? '' : '/min';
    const headerLabel = isAgg ? 'Session progress' : 'Progress vs baseline';
    const deltaNoun = isAgg
        ? (direction === 'regressed' ? 'worse' : 'better')
        : `${direction === 'regressed' ? 'more' : 'fewer'} fillers`;
    const baselineLabel = 'Previous session';

    return (
        <div
            className="rounded-xl border border-[#dbe2ec] bg-white p-4"
            data-testid="progress-vs-baseline"
            data-progress-state={isBaseline ? 'baseline' : tooShort ? 'too-short' : direction}
            role="group"
            aria-label="Progress versus baseline"
        >
            <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#414b5c]">{headerLabel}</p>
                {/* #1222 G1: unobtrusive help affordance top-right — explains what the percentage means. */}
                <button
                    type="button"
                    data-testid="progress-help"
                    aria-label="How progress is measured"
                    title="Session progress: your % change vs your previous session."
                    className="-mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[#c5cfdd] text-[10px] font-bold leading-none text-[#414b5c] hover:bg-[#eef2f7]"
                >
                    ?
                </button>
            </div>

            {isBaseline ? (
                <div className="mt-2" data-testid="progress-baseline-set">
                    <p className="text-[20px] font-extrabold text-[#1f2733]">{isAgg ? 'Baseline signal set' : 'Baseline set'}</p>
                    <p className="mt-1 text-[13px] text-[#414b5c]">
                        {baselineRate}{unit} — we&apos;ll compare each session with the one before.
                    </p>
                </div>
            ) : tooShort ? (
                <div className="mt-2" data-testid="progress-too-short">
                    <p className="text-[40px] font-extrabold leading-none text-[#232c3a]">—</p>
                    <p className="mt-1 text-[13px] text-[#414b5c]">too short to compare</p>
                </div>
            ) : (
                <>
                    <div className="mt-1 flex items-baseline gap-2">
                        <span
                            className="text-[40px] font-extrabold leading-none [font-variant-numeric:tabular-nums]"
                            style={{ color: direction === 'regressed' ? REGRESS : GREEN }}
                            data-testid="progress-delta"
                        >
                            {(deltaPercent ?? 0) >= 0 ? '+' : '−'}{Math.abs(deltaPercent ?? 0)}%
                        </span>
                        <span className="text-[13px] font-bold leading-snug text-[#1f2733]">
                            {deltaNoun}
                            <br />
                            {renderContext(DELTA_CONTEXT[sessionState])}
                        </span>
                    </div>

                    {/* Trend — baseline pinned leftmost; the current (last) column is emphasised. */}
                    <div className="mt-3 flex items-end gap-1.5" data-testid="progress-trend" aria-hidden="true">
                        {trend.map((_, i) => {
                            const isCurrent = i === trend.length - 1;
                            const bg = !isCurrent
                                ? TRACK
                                : direction === 'regressed' ? REGRESS : GREEN_BAR;
                            // The immediately-prior column is muted-green so "you beat last time" reads without a caption.
                            const isPrior = i === trend.length - 2 && direction === 'improved';
                            return (
                                <span
                                    key={i}
                                    className="h-6 flex-1 rounded"
                                    style={{ backgroundColor: isPrior ? GREEN_MUTED_BAR : bg }}
                                />
                            );
                        })}
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[12px] text-[#414b5c]">
                        <span>{baselineLabel} {baselineRate}{unit}</span>
                        <span data-testid="progress-current">{CURRENT_LABEL[sessionState]} {currentRate}{unit}</span>
                    </div>
                </>
            )}
        </div>
    );
};
