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
 */
export const FillerWordsCard: React.FC<FillerWordsCardProps> = ({
    fillerCount,
    fillerData,
    fillerExplanation,
    headerAction,
    className = "",
}) => {
    return (
        <div className={`${SESSION_SURFACE_CLASS} p-3 ${className}`}>
            <div className="mb-2 flex items-center justify-between">
                <h2 className="text-base font-semibold text-foreground">
                    Filler Words <span data-testid="filler-count-value" className="text-foreground/70 ml-1">{fillerCount > 0 ? `(${fillerCount})` : ''}</span>
                </h2>
                {headerAction}
            </div>

            {fillerCount === 0 && Object.keys(fillerData).length > 1 && (
                <p className="mb-2 rounded-md border border-dashed border-[hsl(var(--border-strong))] bg-muted/70 px-3 py-1.5 text-xs font-semibold text-foreground/80">
                    No filler words detected yet. Tracked words are listed below.
                </p>
            )}

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
                {Object.keys(fillerData).length <= 1 && ( // Account for 'total' key
                    <p className="py-1 text-center text-sm font-medium italic text-foreground/70">No words defined</p>
                )}
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
