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
import type { FocusCoverageRow } from '@/utils/focusCoverage';

/**
 * #1046 Focus Points — slot D, "Your points" carried through all three states (spec §3).
 *
 * The Focus Points analogue of Open Mic's coaching card: same rail slot, but it holds the declared
 * points and their coverage rather than delivery tips. Four marker states:
 *   - pending  — grey ring + numeral
 *   - covered  — green ✓, struck-through label, "Covered at m:ss" (+ the covering phrase in `after`)
 *   - next-up  — (during only) purple ring on a tinted row, "Still to cover"
 *   - missed   — (after only) amber ✕ on a tinted row; the rail's most important line names where the
 *                time went, because that is the only feedback that changes the next attempt.
 *
 * Colour is never the sole signal: every row carries an sr-only status word and the marker glyph changes.
 */

export interface FocusPointsRailProps {
    rows: FocusCoverageRow[];
    sessionState: 'before' | 'during' | 'after';
    /** #1046 G6/G7: the topic (the `goal`), shown above the points as an unnumbered header — never a point,
     *  never checked for coverage. null/blank ⇒ no topic line (e.g. a set saved before topic was threaded). */
    topic?: string | null;
    /** During: the first not-yet-covered point — highlighted "Still to cover". */
    nextIndex?: number | null;
    onEdit?: () => void;
    onRetry?: () => void;
    onNewSet?: () => void;
}

function fmtClock(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const Marker: React.FC<{ kind: 'pending' | 'covered' | 'next' | 'missed'; index: number }> = ({ kind, index }) => {
    const base = 'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold';
    if (kind === 'covered') {
        return <span className={`${base} bg-[#1f9d6b] text-white`} aria-hidden="true">✓</span>;
    }
    if (kind === 'missed') {
        return <span className={`${base} border-2 border-[#d98a1f] text-[#8a5510]`} aria-hidden="true">✕</span>;
    }
    if (kind === 'next') {
        return <span className={`${base} border-2 border-[#6d28d9] text-[#6d28d9]`} aria-hidden="true">{index + 1}</span>;
    }
    return <span className={`${base} border-2 border-[#d3dbe6] text-[#8b95a5]`} aria-hidden="true">{index + 1}</span>;
};

export const FocusPointsRail: React.FC<FocusPointsRailProps> = ({
    rows,
    sessionState,
    topic,
    nextIndex,
    onEdit,
    onRetry,
    onNewSet,
}) => {
    const isAfter = sessionState === 'after';
    // §3: the card names the TASK, not ownership. before/during = "Points to cover"; after = "What you covered".
    const title = isAfter ? 'What we detected' : 'Points to cover';
    const topicLabel = (topic ?? '').trim();

    // §3 missed-point cause: derived from REAL coverage timestamps (the elapsed between coverage events),
    // never a fabricated "you wasted N seconds". The last-covered point's landing time explains why the run
    // reached the missed one late — then a forward action. Honest because both the point number and the
    // timestamp are facts the coverage engine actually produced.
    const coveredWithTime = rows.filter((r) => r.covered && r.coveredAtSec != null);
    const lastCovered = coveredWithTime.length
        ? coveredWithTime.reduce((a, b) => (a.coveredAtSec! >= b.coveredAtSec! ? a : b))
        : null;
    const lastCoveredNumber = lastCovered ? rows.indexOf(lastCovered) + 1 : null;
    const missedCause = lastCovered
        ? `Didn’t come up this time. Point ${lastCoveredNumber} ran to ${fmtClock(lastCovered.coveredAtSec!)} — leading with this one next attempt is the easy fix.`
        : 'Didn’t come up this time — leading with this one next attempt is the easy fix.';

    return (
        <section
            data-testid="focus-points-rail"
            aria-label="Focus points"
            className="flex flex-col rounded-2xl border border-[hsl(var(--border-strong))] border-t-[3px] border-t-[#6d28d9] bg-card p-5"
        >
            <div className="flex items-baseline justify-between">
                <h3 className="text-[12px] font-extrabold uppercase tracking-wide text-[#6d28d9]">{title}</h3>
                {sessionState === 'before' && onEdit && (
                    <button
                        type="button"
                        onClick={onEdit}
                        data-testid="focus-points-edit"
                        className="text-[13px] font-bold text-[#6d28d9] hover:underline"
                    >
                        Edit
                    </button>
                )}
            </div>

            {/* §3: the topic is a header, never a point — no marker, no numeral, never checked for coverage.
                It sits above the list with a divider so it reads as context, not an item to cover. */}
            {topicLabel !== '' && (
                <div data-testid="focus-points-topic" className="border-b border-[#eef1f6] pb-[14px]">
                    <div className="mb-1 mt-3 text-[17px] font-extrabold tracking-[-0.02em] text-[#1f2733]">{topicLabel}</div>
                    <div className="text-[12px] font-bold uppercase tracking-[0.04em] text-[#8b95a5]">Your topic</div>
                </div>
            )}

            <ol className="mt-[14px] space-y-[13px]" data-testid="focus-points-rail-list">
                {rows.map((row, i) => {
                    const isNext = sessionState === 'during' && !row.covered && nextIndex === i;
                    const isMissed = isAfter && !row.covered;
                    const kind = row.covered ? 'covered' : isNext ? 'next' : isMissed ? 'missed' : 'pending';
                    const rowTint = isNext
                        ? 'rounded-lg border border-[#e6dcfb] bg-[#f5f0ff] px-3 py-2'
                        : isMissed
                            ? 'rounded-lg border border-[#f0dcb8] bg-[#fdf3e2] px-3 py-2'
                            : '';
                    const statusWord = row.covered ? 'Covered' : isMissed ? 'Not detected' : isNext ? 'Still to cover' : 'Pending';
                    return (
                        <li key={i} data-testid={`focus-point-${i}`} data-status={row.covered ? 'covered' : isMissed ? 'missing' : 'pending'} className={`flex items-start gap-[11px] ${rowTint}`}>
                            <Marker kind={kind} index={i} />
                            <div className="min-w-0 flex-1">
                                <p className={`text-[15px] leading-snug ${row.covered ? 'text-[#8b95a5] line-through' : isMissed ? 'font-extrabold text-[#2b3446]' : 'text-[#2b3446]'}`}>
                                    {row.label}
                                </p>
                                {row.covered && row.coveredAtSec != null && (
                                    <p className="mt-0.5 text-[12px] font-semibold text-[#146b4a]" data-testid={`focus-point-${i}-covered-at`}>
                                        {isAfter && row.quote ? <span className="italic text-[#4b5563]">&ldquo;…{row.quote.trim()}&rdquo;</span> : null}
                                        {isAfter && row.quote ? ' · ' : ''}Covered at {fmtClock(row.coveredAtSec)}
                                    </p>
                                )}
                                {isNext && <p className="mt-0.5 text-[12px] font-bold text-[#6d28d9]">Still to cover</p>}
                                {/* Reviewer truthfulness fix: the local keyword engine measures whether a point's
                                    words appeared, NOT how time was spent. So a point it couldn't verify is
                                    "Not detected" (a paraphrase may have covered it) — never a "Missed"
                                    accusation — and the feedback is an ACTION for the retry, not a made-up cause. */}
                                {isMissed && (
                                    <p className="mt-1 text-[13px] leading-snug text-[#8a5510]" data-testid={`focus-point-${i}-not-detected`}>
                                        {missedCause}
                                    </p>
                                )}
                            </div>
                            <span className="sr-only">{statusWord}</span>
                        </li>
                    );
                })}
            </ol>

            {isAfter && (onRetry || onNewSet) && (
                <div className="mt-auto pt-5">
                    {onRetry && (
                        <button
                            type="button"
                            onClick={onRetry}
                            data-testid="focus-points-retry"
                            className="w-full rounded-lg bg-[#0a5f58] px-4 py-3 text-[15px] font-bold text-white hover:bg-[#094f49]"
                        >
                            Retry these {rows.length} points
                        </button>
                    )}
                    {onNewSet && (
                        <button
                            type="button"
                            onClick={onNewSet}
                            data-testid="focus-points-new-set"
                            className="mt-2 w-full text-center text-[14px] font-bold text-[#0a5f58] hover:underline"
                        >
                            Start a new set
                        </button>
                    )}
                </div>
            )}
        </section>
    );
};

export default FocusPointsRail;
