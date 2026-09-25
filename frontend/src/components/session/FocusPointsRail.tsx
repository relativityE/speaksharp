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
 *   - missed   — (after only) red numbered ring on a tinted row, a visible "Not detected"; the rail's most important line names where the
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
    /**
     * G20 B3: the take is complete and its points can no longer be checked (the transcript is gone or the
     * finalized verdict is terminally absent). Says so plainly instead of "Checking…", which would never end.
     */
    checkUnavailable?: boolean;
    /** #1046 G6/G7: the topic (the `goal`), shown above the points as an unnumbered header — never a point,
     *  never checked for coverage. null/blank ⇒ no topic line (e.g. a set saved before topic was threaded). */
    topic?: string | null;
    /** During: the first not-yet-covered point — highlighted "Still to cover". */
    nextIndex?: number | null;
    onEdit?: () => void;
    onRetry?: () => void;
    /** #1533: true while the live same-owner Progress gate holds Start (the same predicate as the mic). */
    retryDisabled?: boolean;
    /** The id of the visible reason for the hold, announced with the disabled action. */
    retryDescribedBy?: string;
    onNewSet?: () => void;
}

function fmtClock(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type MarkerKind = 'pending' | 'checking' | 'covered' | 'partial' | 'next' | 'missed';

/**
 * #1258 RWT (PO/PM 2026-09-25) — ONE COLOUR PER STATE, EXPLAINED ON SCREEN: grey = not heard yet, yellow = partly
 * detected, green = detected during speech, red = Not detected, a FINAL verdict shown only after Stop. The glyph
 * and a visible word carry each state too, so colour is never the only signal.
 */
const MARKER_STYLE: Record<MarkerKind, string> = {
    covered: 'bg-progress-bar text-white',
    partial: 'border-2 border-signature bg-signature text-ink',
    missed: 'border-2 border-state-error text-state-error',
    next: 'border-2 border-focus-points text-focus-points',
    pending: 'border-2 border-neutral-border-strong text-neutral-muted',
    // G20 B2: a dashed grey ring = we haven't finished checking. Never green, yellow or red until a result.
    checking: 'border-2 border-dashed border-neutral-border-strong text-neutral-muted',
};

const Marker: React.FC<{ kind: MarkerKind; index: number; testId?: string }> = ({ kind, index, testId }) => {
    // A negative index is the legend's empty circle: a key, not a numbered point. "Not detected" keeps the point's
    // number in a red ring — a detector result, never a "wrong answer" ✕ (PM review of G20, 2026-09-25).
    const glyph = kind === 'covered' ? '✓' : kind === 'partial' ? '≈' : index < 0 ? '' : String(index + 1);
    return (
        <span
            className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold ${MARKER_STYLE[kind]}`}
            aria-hidden="true"
            data-testid={testId}
            data-marker={kind}
        >
            {glyph}
        </span>
    );
};

/** The on-screen key for the four states. "Not detected" is labelled as an after-Stop verdict. */
const LEGEND: ReadonlyArray<{ kind: MarkerKind; label: string }> = [
    { kind: 'pending', label: 'Not heard yet' },
    { kind: 'partial', label: 'Partly detected' },
    { kind: 'covered', label: 'Detected' },
    { kind: 'missed', label: 'Not detected (after you stop)' },
];

export const FocusPointsRail: React.FC<FocusPointsRailProps> = ({
    rows,
    sessionState,
    coveragePending = false,
    checkUnavailable = false,
    topic,
    nextIndex,
    onEdit,
    onRetry,
    retryDisabled = false,
    retryDescribedBy,
    onNewSet,
}) => {
    const isAfter = sessionState === 'after';
    const unavailable = isAfter && checkUnavailable;
    const checking = isAfter && coveragePending && !unavailable;
    const verdict = isAfter && !coveragePending && !unavailable;
    // §3: the card names the TASK, not ownership. G20: after = "What we detected", or "Checking your points"
    // while the verdict is still being computed; before/during and an unavailable check = "Points to cover".
    const title = verdict ? 'What we detected' : checking ? 'Checking your points' : 'Points to cover';
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

            {/* The topic is a header, never a point — no marker, no numeral, never checked for coverage.
                Design Correction Brief F-5: eyebrow above value, always. It used to render the topic and then
                a `Your topic` caption BENEATH it, which made the topic read as the first item of the list.
                The card's own eyebrow already labels it, and as the largest text here it needs no caption. */}
            {topicLabel !== '' && (
                <div data-testid="focus-points-topic" className="border-b border-neutral-border-soft pb-[14px]">
                    <div className="mt-2 text-[20px] font-extrabold leading-tight tracking-[-0.02em] text-neutral-body">{topicLabel}</div>
                </div>
            )}

            {unavailable && (
                <p className="mt-3 text-[16px] font-extrabold leading-snug text-neutral-body" data-testid="focus-points-check-unavailable" role="status">
                    We couldn&rsquo;t check your points this time. Your session is saved.
                </p>
            )}

            {/* The key explains result colours; it is omitted while checking or when no check is possible. */}
            {!checking && !unavailable && (
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5" data-testid="focus-points-legend" aria-label="What the colours mean">
                {LEGEND.map((item) => (
                    <li key={item.kind} className="flex items-center gap-1.5 text-[12px] font-semibold text-neutral-secondary" data-state={item.kind}>
                        <Marker kind={item.kind} index={-1} />
                        <span>{item.label}</span>
                    </li>
                ))}
            </ul>
            )}

            <ol className="mt-[14px] space-y-[13px]" data-testid="focus-points-rail-list">
                {rows.map((row, i) => {
                    const isPartial = row.status === 'partial';
                    const isNext = sessionState === 'during' && !row.covered && nextIndex === i;
                    const isMissed = verdict && !row.covered;
                    const kind: MarkerKind = isPartial ? 'partial' : row.covered ? 'covered' : isNext ? 'next' : isMissed ? 'missed' : checking ? 'checking' : 'pending';
                    const rowTint = isPartial
                        ? 'rounded-lg border border-signature-border bg-signature-ground px-3 py-2'
                        : isNext
                        ? 'rounded-lg border border-focus-points-border bg-focus-points-ground px-3 py-2'
                        : isMissed
                            ? 'rounded-lg border border-state-error-border bg-state-error-ground px-3 py-2'
                            : '';
                    // 'Detected', not 'Covered': the matcher reports what it FOUND. 'Still to cover' stays — that is an
    // instruction about what to do next, not an assertion about what the speaker did.
    const statusWord = isPartial ? 'Partly detected' : row.covered ? 'Detected' : isMissed ? 'Not detected' : isNext ? 'Still to cover' : 'Pending';
                    return (
                        <li key={i} data-testid={`focus-point-${i}`} data-status={isPartial ? 'partial' : row.covered ? 'covered' : isMissed ? 'missing' : 'pending'} className={`flex items-start gap-[11px] ${rowTint}`}>
                            <Marker kind={kind} index={i} testId={`focus-point-${i}-marker`} />
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
                                {(kind === 'checking' || (kind === 'pending' && !unavailable)) && (
                                    <p className="mt-0.5 text-[12px] font-semibold text-neutral-muted" data-testid={`focus-point-${i}-pending`}>
                                        {kind === 'checking' ? 'Checking…' : 'Not heard yet'}
                                    </p>
                                )}
                                {/* Reviewer truthfulness fix: the local keyword engine measures whether a point's
                                    words appeared, NOT how time was spent. So a point it couldn't verify is
                                    "Not detected" (a paraphrase may have covered it) — never a "Missed"
                                    accusation — and the feedback is an ACTION for the retry, not a made-up cause. */}
                                {isMissed && (
                                    <p className="mt-0.5 text-[12px] font-bold text-state-error" data-testid={`focus-point-${i}-status`}>Not detected</p>
                                )}
                                {isMissed && (
                                    <p className="mt-1 text-[13px] leading-snug text-state-error" data-testid={`focus-point-${i}-not-detected`}>
                                        We couldn’t detect this point in the transcript. You may have covered it in different words.
                                    </p>
                                )}
                            </div>
                            {/* Every row shows its status visibly, except a detected row without a time; only that one
                                needs the word for screen readers. */}
                            {row.covered && row.coveredAtSec == null && <span className="sr-only">{statusWord}</span>}
                        </li>
                    );
                })}
            </ol>

            {/*
              * #1467 — tell the USER what the detector can and cannot do, on the completed verdict only.
              *
              * The limitation is documented four times in this codebase and every one of them speaks to
              * engineers: the header comments in this file and in CoverageRail and
              * CoveragePace all describe a conservative LOCAL KEYWORD MATCHER. Nothing said it to the person
              * reading "Not detected", who had no way to tell whether the miss was theirs or the matcher's.
              *
              * Shown only when a verdict is actually being presented, because before or during a take (or while
              * checking) there is no verdict for it to qualify. G20: once, below the list.
              */}
            {verdict && (
                <p
                    data-testid="focus-points-detection-note"
                    className="mt-4 text-[13px] leading-snug text-neutral-secondary"
                >
                    We look for your point&rsquo;s words in what you said. If you covered it differently, we may not spot it.
                </p>
            )}


            {isAfter && (onRetry || onNewSet) && (
                <div className="mt-auto pt-5">
                    {onRetry && (
                        <button
                            type="button"
                            onClick={onRetry}
                            disabled={retryDisabled}
                            aria-describedby={retryDisabled ? retryDescribedBy : undefined}
                            data-testid="focus-points-retry"
                            className="w-full rounded-lg bg-signature px-4 py-3 text-[15px] font-bold text-ink hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
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
