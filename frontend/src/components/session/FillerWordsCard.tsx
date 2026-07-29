import { Tags } from 'lucide-react';
import { getWordColor } from '@/utils/highlightUtils';
import { SESSION_SURFACE_CLASS } from './sessionSurface';

interface FillerWordData {
    count: number;
    lastOccurrence?: number;
}

interface FillerWordsCardProps {
    fillerCount: number;
    fillerData: Record<string, FillerWordData>;
    fillerExplanation?: string;
    headerAction?: React.ReactNode;
    className?: string;
}

/**
 * Presentational component displaying the filler words metric.
 * Extracted from SessionPage for better reusability and testability.
 *
 * #1047 — PRE-SESSION COLLAPSE. Before anyone speaks this was the largest and densest block on the
 * page while carrying exactly zero information: thirteen chips each reading `0`, plus TWO
 * contradictory empty-state messages ("No filler words detected yet…" and "No transcript was
 * captured, so filler words cannot be verified yet"). Both are gone; neither survived. One line now
 * states what is being tracked and when numbers will appear, and the chip grid is revealed only once
 * there is something to read in it. The tracked count is DERIVED from the actual tracked-word list so
 * it can never drift from reality (custom words included) — it is never a hard-coded 13.
 */
export const FillerWordsCard: React.FC<FillerWordsCardProps> = ({
    fillerCount,
    fillerData,
    fillerExplanation,
    headerAction,
    className = "",
}) => {
    const trackedWords = Object.keys(fillerData).filter((key) => key !== 'total');
    const trackedCount = trackedWords.length;
    // "Counts exist" means the evidence band has something to show. Judged from the per-word data, not
    // only the rollup, so a non-zero word always expands the grid.
    const hasCounts = fillerCount > 0
        || trackedWords.some((word) => (fillerData[word]?.count ?? 0) > 0);

    if (!hasCounts) {
        return (
            <div
                className={`bg-card border border-[hsl(var(--border-strong))] rounded-2xl px-[26px] py-[20px] flex flex-wrap items-center justify-between gap-4 ${className}`}
                data-testid="filler-words-card"
                data-filler-collapsed="true"
            >
                <div className="flex min-w-0 items-center gap-3">
                    <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--session-warm-tile))] text-[hsl(var(--session-warm-tile-text))]"
                        aria-hidden="true"
                    >
                        <Tags className="h-[18px] w-[18px]" />
                    </span>
                    {/* The ONE pre-session message. It replaces the 13 zero chips AND both former
                        empty-state sentences — it says what is tracked and when numbers arrive, which
                        is everything the two contradictory messages were trying to say between them. */}
                    <p className="text-[15px] font-bold leading-snug text-foreground" data-testid="filler-tracking-summary">
                        {`Tracking ${trackedCount} filler ${trackedCount === 1 ? 'word' : 'words'} — counts appear here once you speak.`}
                    </p>
                </div>
                {headerAction}
            </div>
        );
    }

    return (
        <div className={`${SESSION_SURFACE_CLASS} p-3 ${className}`} data-testid="filler-words-card" data-filler-collapsed="false">
            <div className="mb-2 flex items-center justify-between">
                <h2 className="text-base font-semibold text-foreground">
                    Detected filler words <span data-testid="filler-count-value" className="text-foreground/70 ml-1">{fillerCount > 0 ? `(${fillerCount})` : ''}</span>
                </h2>
                {headerAction}
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,88px))] gap-1.5" data-testid="filler-words-list">
                {Object.entries(fillerData)
                    .filter(([key]) => key !== 'total')
                    .sort(([, a], [, b]) => b.count - a.count)
                    .map(([word, data]) => {
                        const isZero = data.count === 0;
                        const wordColor = getWordColor(word.toLowerCase());
                        return (
                            <div
                                key={word}
                                className={`flex min-h-[48px] flex-col items-center justify-center rounded-md px-1.5 py-1 text-center ${isZero ? 'bg-muted/40' : 'bg-white border border-[hsl(var(--border-strong))]'}`}
                                data-testid={`filler-row-${word.toLowerCase()}`}
                                data-filler-word={word.toLowerCase()}
                                data-filler-count={data.count}
                            >
                                <span
                                    className={`max-w-full truncate text-sm leading-tight ${isZero ? 'font-extrabold text-foreground/85' : 'font-black'}`}
                                    style={{
                                        color: isZero ? undefined : wordColor,
                                    }}
                                >
                                    {word}
                                </span>
                                <span
                                    data-testid="filler-badge-count"
                                    className={`mt-0.5 text-xl font-black leading-none ${!isZero ? "" : "text-foreground/85"}`}
                                    style={{ color: !isZero ? wordColor : undefined }}
                                >
                                    {data.count}
                                </span>
                            </div>
                        );
                    })
                }
            </div>
            {fillerExplanation && (
                <p className="mt-2 border-t border-[hsl(var(--border))] pt-2 text-xs font-medium leading-snug text-foreground/75" data-testid="filler-explanation">
                    {fillerExplanation}
                </p>
            )}
        </div>
    );
};

export default FillerWordsCard;
