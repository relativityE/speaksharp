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
        <div className={`${SESSION_SURFACE_CLASS} p-4 h-full ${className}`}>
            <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold text-foreground">
                    Filler Words <span data-testid="filler-count-value" className="text-foreground/70 ml-1">{fillerCount > 0 ? `(${fillerCount})` : ''}</span>
                </h2>
                {headerAction}
            </div>

            {fillerCount === 0 && Object.keys(fillerData).length > 1 && (
                <p className="mb-3 rounded-lg border border-dashed border-[hsl(var(--border-strong))] bg-muted/70 px-3 py-2 text-xs font-semibold text-foreground/80">
                    No filler words detected yet. Tracked words are listed below.
                </p>
            )}

            <div className="space-y-2" data-testid="filler-words-list">
                {Object.entries(fillerData)
                    .filter(([key]) => key !== 'total')
                    .sort(([, a], [, b]) => b.count - a.count)
                    .map(([word, data]) => {
                        const isZero = data.count === 0;
                        const wordColor = getWordColor(word.toLowerCase());
                        return (
                            <div key={word} className={`flex items-center justify-between rounded-md px-2 py-1 ${isZero ? 'bg-transparent' : 'bg-white border border-[hsl(var(--border))]'}`} data-testid="filler-badge">
                                <span
                                    className={`text-sm px-2 py-0.5 rounded border ${isZero ? 'font-semibold text-foreground/70' : 'font-bold'}`}
                                    style={{
                                        color: isZero ? undefined : wordColor,
                                        borderColor: isZero ? 'transparent' : `${wordColor}40`,
                                        backgroundColor: isZero ? 'transparent' : `${wordColor}10`
                                    }}
                                >
                                    {word}
                                </span>
                                <span
                                    data-testid="filler-badge-count"
                                    className={`font-bold ${!isZero ? "" : "text-foreground/70"}`}
                                    style={{ color: !isZero ? wordColor : undefined }}
                                >
                                    {data.count}
                                </span>
                            </div>
                        );
                    })
                }
                {Object.keys(fillerData).length <= 1 && ( // Account for 'total' key
                    <p className="py-2 text-center text-sm font-medium italic text-foreground/70">No words defined</p>
                )}
            </div>
            {fillerExplanation && (
                <p className="mt-3 border-t border-[hsl(var(--border))] pt-3 text-xs font-medium leading-snug text-foreground/75" data-testid="filler-explanation">
                    {fillerExplanation}
                </p>
            )}
        </div>
    );
};

export default FillerWordsCard;
