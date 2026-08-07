import { Tags } from 'lucide-react';
import { getWordColor } from '@/utils/highlightUtils';
import { ANALYTICS_THRESHOLDS, FILLER_TRANSCRIPT_DISCLOSURE } from '@/utils/sessionAnalysis';
import { SESSION_SURFACE_CLASS } from './sessionSurface';

interface FillerWordData {
    count: number;
    lastOccurrence?: number;
}

/** The six states this card can be in. Exposed as `data-filler-state` for tests and diagnostics. */
export type FillerCardState =
    | 'before-recording'
    | 'listening'
    | 'finalizing'
    | 'zero-detected'
    | 'counts'
    | 'insufficient-transcript';

interface FillerWordsCardProps {
    fillerCount: number;
    fillerData: Record<string, FillerWordData>;
    fillerExplanation?: string;
    /** Words captured so far. Separates a verified zero from "we could not verify". */
    wordCount?: number;
    /** Recording is live. */
    isListening?: boolean;
    /** Post-stop decode is running — no result exists yet, not even a zero. */
    isFinalizing?: boolean;
    /** A transcript exists or a take has completed. Distinguishes "nothing yet" from a real result. */
    hasSpoken?: boolean;
    headerAction?: React.ReactNode;
    className?: string;
}

/** The card's accessible name. Stable in EVERY state, including when the visual heading collapses. */
export const FILLER_CARD_ACCESSIBLE_NAME = 'Detected filler words';

/**
 * The filler-words evidence band.
 *
 * #1047 — SIX states, because collapsing them was how this card came to make false claims.
 *
 * Before this change the card had exactly one pre-result appearance: thirteen chips reading `0` plus
 * two contradictory empty messages. Collapsing that to a single row was right, but a two-state
 * collapse (counts / no-counts) reintroduced the same class of bug from the other direction — it told
 * a user who had just finished speaking that counts would appear "once you speak", and it suppressed
 * `fillerExplanation`, which at `fillerCount === 0` is exactly where the #894 truthfulness disclosure
 * lives. The states below exist so that every message the card can show is true at the moment it
 * shows it:
 *
 *   1. before-recording          — nothing has happened yet.
 *   2. listening                 — recording, nothing detected YET. Not a result. No zero chips.
 *   3. finalizing                — the decode is still running, so NO count is claimed, not even zero.
 *   4. zero-detected             — a valid transcript genuinely contained none. A RESULT, and it
 *                                  carries the #894 disclosure, because an unqualified `0` is exactly
 *                                  what a user is most likely to over-trust.
 *   5. counts                    — real evidence: the chip grid, showing only words that actually
 *                                  occurred, with the disclosure once.
 *   6. insufficient-transcript   — we could not verify. Deliberately NOT the same claim as state 4:
 *                                  "none detected" and "could not check" are different statements and
 *                                  must never share copy.
 *
 * The tracked count is DERIVED from the real tracked-word list, so it follows custom words rather than
 * drifting from a hard-coded 13. The "Add your filler words" action is present in every state.
 */
export const FillerWordsCard: React.FC<FillerWordsCardProps> = ({
    fillerCount,
    fillerData,
    fillerExplanation,
    wordCount = 0,
    isListening = false,
    isFinalizing = false,
    hasSpoken = false,
    headerAction,
    className = "",
}) => {
    const trackedWords = Object.keys(fillerData).filter((key) => key !== 'total');
    const trackedCount = trackedWords.length;
    // Judged from the per-word data, not only the rollup, so a non-zero word always counts as evidence.
    const hasCounts = fillerCount > 0
        || trackedWords.some((word) => (fillerData[word]?.count ?? 0) > 0);
    const hasEnoughTranscript = wordCount >= ANALYTICS_THRESHOLDS.MIN_RELIABLE_SCORING_WORDS;

    // Order matters. Finalizing wins over everything: mid-decode the live count is still moving, so
    // showing it would assert a result that does not exist yet. Counts win next — real evidence is
    // shown as soon as it exists, including DURING recording.
    const state: FillerCardState =
        isFinalizing ? 'finalizing'
            : hasCounts ? 'counts'
                : isListening ? 'listening'
                    : hasSpoken ? (hasEnoughTranscript ? 'zero-detected' : 'insufficient-transcript')
                        : 'before-recording';

    const surfaceProps = {
        'aria-label': FILLER_CARD_ACCESSIBLE_NAME,
        'data-testid': 'filler-words-card',
        'data-filler-state': state,
        'data-filler-collapsed': state === 'counts' ? 'false' : 'true',
    } as const;

    if (state !== 'counts') {
        // Every collapsed state shares one shape — glyph, one heading, optional supporting line, and
        // the action — so only the CLAIM changes between them, never the furniture.
        const { heading, support, headingTestId } = {
            'before-recording': {
                heading: `Tracking ${trackedCount} filler ${trackedCount === 1 ? 'word' : 'words'}`,
                support: 'Counts appear here as you speak.',
                headingTestId: 'filler-tracking-summary',
            },
            listening: {
                heading: `Listening for ${trackedCount} filler ${trackedCount === 1 ? 'word' : 'words'}`,
                support: undefined,
                headingTestId: 'filler-listening-summary',
            },
            finalizing: {
                heading: 'Checking your transcript for filler words',
                support: undefined,
                headingTestId: 'filler-finalizing-summary',
            },
            'zero-detected': {
                heading: 'No detected filler words in this transcript.',
                // #894: the caveat belongs with the zero it qualifies. Only the disclosure is used
                // here, NOT the full `fillerExplanation` — that string opens with its own "No filler
                // words were detected", which would state the result twice in one card.
                support: FILLER_TRANSCRIPT_DISCLOSURE,
                headingTestId: 'filler-measured-zero',
            },
            'insufficient-transcript': {
                heading: 'Not enough transcript to verify filler words.',
                support: undefined,
                headingTestId: 'filler-unverified',
            },
        }[state];

        return (
            <section
                {...surfaceProps}
                className={`bg-card border border-[hsl(var(--border-strong))] rounded-2xl px-[26px] py-[20px] flex flex-wrap items-center justify-between gap-4 ${className}`}
            >
                <div className="flex min-w-0 items-center gap-3">
                    <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--session-warm-tile))] text-[hsl(var(--session-warm-tile-text))]"
                        aria-hidden="true"
                    >
                        <Tags className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0">
                        <p className="text-[15px] font-bold leading-snug text-foreground" data-testid={headingTestId}>
                            {heading}
                        </p>
                        {support && (
                            <p
                                className="mt-1 text-sm leading-snug text-foreground/80"
                                data-testid={state === 'zero-detected' ? 'filler-explanation' : 'filler-support-text'}
                            >
                                {support}
                            </p>
                        )}
                    </div>
                </div>
                {headerAction}
            </section>
        );
    }

    // State 5 — real evidence. Only words that ACTUALLY occurred are shown: padding the grid with
    // every tracked word at zero is the density this card exists to remove, and a `0` chip next to a
    // real count reads as a measurement rather than as filler.
    const detectedWords = Object.entries(fillerData)
        .filter(([key, data]) => key !== 'total' && data.count > 0)
        .sort(([, a], [, b]) => b.count - a.count);

    return (
        <section {...surfaceProps} className={`${SESSION_SURFACE_CLASS} p-3 ${className}`}>
            <div className="mb-2 flex items-center justify-between">
                <h2 className="text-base font-semibold text-foreground">
                    {FILLER_CARD_ACCESSIBLE_NAME} <span data-testid="filler-count-value" className="text-foreground/70 ml-1">{fillerCount > 0 ? `(${fillerCount})` : ''}</span>
                </h2>
                {headerAction}
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,88px))] gap-1.5" data-testid="filler-words-list">
                {detectedWords.map(([word, data]) => {
                    const wordColor = getWordColor(word.toLowerCase());
                    return (
                        <div
                            key={word}
                            className="flex min-h-[48px] flex-col items-center justify-center rounded-md border border-[hsl(var(--border-strong))] bg-white px-1.5 py-1 text-center"
                            data-testid={`filler-row-${word.toLowerCase()}`}
                            data-filler-word={word.toLowerCase()}
                            data-filler-count={data.count}
                        >
                            <span
                                className="max-w-full truncate text-sm font-black leading-tight"
                                style={{ color: wordColor }}
                            >
                                {word}
                            </span>
                            <span
                                data-testid="filler-badge-count"
                                className="mt-0.5 text-xl font-black leading-none"
                                style={{ color: wordColor }}
                            >
                                {data.count}
                            </span>
                        </div>
                    );
                })}
            </div>
            {/* The disclosure, once. `fillerExplanation` already ends with it at every count. */}
            {fillerExplanation && (
                <p className="mt-2 border-t border-[hsl(var(--border))] pt-2 text-xs font-medium leading-snug text-foreground/75" data-testid="filler-explanation">
                    {fillerExplanation}
                </p>
            )}
        </section>
    );
};

export default FillerWordsCard;
