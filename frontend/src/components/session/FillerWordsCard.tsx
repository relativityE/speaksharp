import { getWordColor } from '@/utils/highlightUtils';

interface FillerWordData {
    count: number;
    lastOccurrence?: number;
}

interface FillerWordsCardProps {
    fillerCount: number;
    fillerData: Record<string, FillerWordData>;
    headerAction?: React.ReactNode;
}

/**
 * Presentational component displaying the filler words metric.
 * Extracted from SessionPage for better reusability and testability.
 */
export const FillerWordsCard: React.FC<FillerWordsCardProps> = ({
    fillerCount,
    fillerData,
    headerAction,
}) => {
    return (
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm h-full">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">
                    Filler Words <span data-testid="filler-count-value" className="text-secondary ml-1">{fillerCount > 0 ? `(${fillerCount})` : ''}</span>
                </h2>
                {headerAction}
            </div>

            <div className="space-y-3" data-testid="filler-words-list">
                {Object.entries(fillerData)
                    .filter(([key]) => key !== 'total')
                    .sort(([, a], [, b]) => b.count - a.count)
                    .map(([word, data]) => {
                        const isZero = data.count === 0;
                        const wordColor = getWordColor(word.toLowerCase());
                        return (
                            <div key={word} className="flex items-center justify-between" data-testid="filler-badge">
                                <span
                                    className="text-sm font-bold px-2 py-0.5 rounded border"
                                    style={{
                                        color: isZero ? 'inherit' : wordColor,
                                        borderColor: isZero ? 'transparent' : `${wordColor}40`,
                                        backgroundColor: isZero ? 'transparent' : `${wordColor}10`
                                    }}
                                >
                                    "{word}"
                                </span>
                                <span
                                    data-testid="filler-badge-count"
                                    className={`font-bold ${!isZero ? "" : "text-muted-foreground"}`}
                                    style={{ color: !isZero ? wordColor : undefined }}
                                >
                                    {data.count}
                                </span>
                            </div>
                        );
                    })
                }
                {Object.keys(fillerData).length <= 1 && ( // Account for 'total' key
                    <p className="text-sm text-muted-foreground italic text-center py-2">No words defined</p>
                )}
            </div>
        </div>
    );
};

export default FillerWordsCard;
