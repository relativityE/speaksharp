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
         *   - covered  — green ✓, struck-through label, "Detected at m:ss" (+ the covering phrase in `after`)
 *   - next-up  — (during only) purple ring on a tinted row, "Still to cover"
 *   - missed   — (after only) amber ✕ on a tinted row; the rail's most important line names where the
 *                time went, because that is the only feedback that changes the next attempt.
 *
 * Colour is never the sole signal: every row carries an sr-only status word and the marker glyph changes.
 */

export interface FocusPointsRailProps {
    rows: FocusCoverageRow[];
    sessionState: 'before' | 'during' | 'after';
    /**
     * The take is complete, but retained transcript evidence is unavailable. Keep after-state actions
     * without turning unknown rows into negative coverage claims.
     */
    coveragePending?: boolean;
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

const Marker: React.FC<{ kind: 'pending' | 'covered' | 'partial' | 'next' | 'missed'; index: number }> = ({ kind, index }) => {
    const base = 'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold';
    if (kind === 'covered') {
        return <span className={`${base} bg-progress-bar text-white`} aria-hidden="true">✓</span>;
    }
    if (kind === 'missed') {
        return <span className={`${base} border-2 border-signature text-signature-text`} aria-hidden="true">✕</span>;
    }
    if (kind === 'partial') {
        return <span className={`${base} border-2 border-signature text-signature-text`} aria-hidden="true">≈</span>;
    }
    if (kind === 'next') {
        return <span className={`${base} border-2 border-focus-points text-focus-points`} aria-hidden="true">{index + 1}</span>;
    }
    return <span className={`${base} border-2 border-neutral-border-strong text-neutral-muted`} aria-hidden="true">{index + 1}</span>;
};

export const FocusPointsRail: React.FC<FocusPointsRailProps> = ({
    rows,
    sessionState,
    coveragePending = false,
    topic,
    nextIndex,
    onEdit,
    onRetry,
    onNewSet,
}) => {
    const isAfter = sessionState === 'after';
    // §3: the card names the TASK, not ownership. before/during = "Points to cover"; after = "What you covered".
    const title = isAfter && !coveragePending ? 'What we detected' : 'Points to cover';
    const topicLabel = (topic ?? '').trim();

    return (
        <section
            data-testid="focus-points-rail"
            aria-label="Focus points"
            className="flex flex-col rounded-2xl border border-neutral-border-strong border-t-[3px] border-t-focus-points bg-card p-5"
        >
            <div className="flex items-baseline justify-between">
                <h3 className="text-[12px] font-extrabold uppercase tracking-wide text-focus-points">{title}</h3>
                {sessionState === 'before' && onEdit && (
                    <button
                        type="button"
                        onClick={onEdit}
                        data-testid="focus-points-edit"
                        className="text-[13px] font-bold text-neutral-secondary hover:underline"
                    >
                        Edit
                    </button>
                )}
            </div>

            {/*
              * #1467 — tell the USER what the detector can and cannot do, on the completed verdict only.
              *
              * The limitation is documented four times in this codebase and every one of them speaks to
              * engineers: the header comments in this file and in CoverageRail, CoverageThisRun and
              * CoveragePace all describe a conservative LOCAL KEYWORD MATCHER. Nothing said it to the person
              * reading "Not detected", who had no way to tell whether the miss was theirs or the matcher's.
              *
              * Shown only when a verdict is actually being presented (`isAfter && !coveragePending`), because
              * before or during a take there is no verdict for it to qualify.
              */}
            {isAfter && !coveragePending && (
                <p
                    data-testid="focus-points-detection-note"
                    className="mt-2 text-[13px] leading-snug text-neutral-secondary"
                >
                    We look for your point&rsquo;s words in what you said. If you covered it differently, we may not spot it.
                </p>
            )}

            {/* §3: the topic is a header, never a point — no marker, no numeral, never checked for coverage.
                It sits above the list with a divider so it reads as context, not an item to cover. */}
            {topicLabel !== '' && (
                <div data-testid="focus-points-topic" className="border-b border-neutral-border-soft pb-[14px]">
                    <div className="mb-1 mt-3 text-[17px] font-extrabold tracking-[-0.02em] text-neutral-body">{topicLabel}</div>
                    <div className="text-[12px] font-bold uppercase tracking-[0.04em] text-neutral-muted">Your topic</div>
                </div>
            )}

            <ol className="mt-[14px] space-y-[13px]" data-testid="focus-points-rail-list">
                {rows.map((row, i) => {
                    const isPartial = row.status === 'partial';
                    const isNext = sessionState === 'during' && !row.covered && nextIndex === i;
                    const isMissed = isAfter && !coveragePending && !row.covered;
                    const kind = isPartial ? 'partial' : row.covered ? 'covered' : isNext ? 'next' : isMissed ? 'missed' : 'pending';
                    const rowTint = isPartial
                        ? 'rounded-lg border border-signature-border bg-signature-ground px-3 py-2'
                        : isNext
                        ? 'rounded-lg border border-focus-points-border bg-focus-points-ground px-3 py-2'
                        : isMissed
                            ? 'rounded-lg border border-signature-border bg-signature-ground px-3 py-2'
                            : '';
                    // 'Detected', not 'Covered': the matcher reports what it FOUND. 'Still to cover' stays — that is an
    // instruction about what to do next, not an assertion about what the speaker did.
    const statusWord = isPartial ? 'Partly detected' : row.covered ? 'Detected' : isMissed ? 'Not detected' : isNext ? 'Still to cover' : 'Pending';
                    return (
                        <li key={i} data-testid={`focus-point-${i}`} data-status={isPartial ? 'partial' : row.covered ? 'covered' : isMissed ? 'missing' : 'pending'} className={`flex items-start gap-[11px] ${rowTint}`}>
                            <Marker kind={kind} index={i} />
                            <div className="min-w-0 flex-1">
                                <p className={`text-[15px] leading-snug ${row.covered && !isPartial ? 'text-neutral-muted line-through' : isPartial || isMissed ? 'font-extrabold text-neutral-body' : 'text-neutral-body'}`}>
                                    {row.label}
                                </p>
                                {row.covered && row.coveredAtSec != null && (
                                    <p className={`mt-0.5 text-[12px] font-semibold ${isPartial ? 'text-signature-text' : 'text-status'}`} data-testid={`focus-point-${i}-covered-at`}>
                                        {isAfter && row.quote ? <span className="italic text-neutral-secondary">&ldquo;…{row.quote.trim()}&rdquo;</span> : null}
                                        {isAfter && row.quote ? ' · ' : ''}{isPartial ? 'Partly detected' : 'Detected'} at {fmtClock(row.coveredAtSec)}
                                    </p>
                                )}
                                {isNext && <p className="mt-0.5 text-[12px] font-bold text-focus-points">Still to cover</p>}
                                {/* Reviewer truthfulness fix: the local keyword engine measures whether a point's
                                    words appeared, NOT how time was spent. So a point it couldn't verify is
                                    "Not detected" (a paraphrase may have covered it) — never a "Missed"
                                    accusation — and the feedback is an ACTION for the retry, not a made-up cause. */}
                                {isMissed && (
                                    <p className="mt-1 text-[13px] leading-snug text-signature-text" data-testid={`focus-point-${i}-not-detected`}>
                                        We couldn’t detect this point in the transcript. You may have covered it in different words.
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
                            className="w-full rounded-lg bg-signature px-4 py-3 text-[15px] font-bold text-ink hover:brightness-95"
                        >
                            Retry this set
                        </button>
                    )}
                    {onNewSet && (
                        <button
                            type="button"
                            onClick={onNewSet}
                            data-testid="focus-points-new-set"
                            className="mt-2 w-full text-center text-[14px] font-bold text-signature-text hover:underline"
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
