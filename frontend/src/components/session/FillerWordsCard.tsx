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
                    Filler Words <span data-testid="filler-count-value" className="text-[#4B5563] ml-1">{fillerCount > 0 ? `(${fillerCount})` : ''}</span>
                </h2>
                {headerAction}
            </div>

            {fillerCount === 0 && Object.keys(fillerData).length > 1 && (
                <p className="mb-3 text-xs font-medium text-[#4B5563]">
                    No filler words detected yet.
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
                            <div key={word} className="flex items-center justify-between" data-testid="filler-badge">
                                <span
                                    className={`text-sm px-2 py-0.5 rounded border ${isZero ? 'font-semibold text-[#4B5563]' : 'font-bold'}`}
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
                                    className={`font-bold ${!isZero ? "" : "text-[#64748B]"}`}
                                    style={{ color: !isZero ? wordColor : undefined }}
                                >
                                    {data.count}
                                </span>
                            </div>
                        );
                    })
                }
                {Object.keys(fillerData).length <= 1 && ( // Account for 'total' key
                    <p className="text-sm text-[#4B5563] italic text-center py-2">No words defined</p>
                )}
            </div>
            {fillerExplanation && (
                <p className="text-xs text-[#4B5563] leading-snug mt-3 border-t border-[hsl(var(--border))] pt-3" data-testid="filler-explanation">
                    {fillerExplanation}
                </p>
            )}
        </div>
    );
};

export default FillerWordsCard;
