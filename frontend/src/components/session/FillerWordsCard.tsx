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
    fillerData,
    headerAction,
}) => {
    return (
        <div className="glass rounded-2xl p-6 h-full">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-foreground">
                    Filler Tracking
                </h2>
                {headerAction}
            </div>

            <div className="space-y-4" data-testid="filler-words-list">
                {Object.entries(fillerData)
                    .filter(([key]) => key !== 'total')
                    .sort(([, a], [, b]) => b.count - a.count)
                    .map(([word, data]) => {
                        const isZero = data.count === 0;
                        return (
                            <div key={word} className="flex items-center justify-between" data-testid="filler-badge">
                                <span
                                    className={`text-sm font-medium px-3 py-1 rounded-full border transition-colors ${
                                        isZero ? "border-white/5 text-muted-foreground/60" : "border-secondary/30 bg-secondary/10 text-secondary"
                                    }`}
                                >
                                    {word}
                                </span>
                                <span
                                    data-testid="filler-badge-count"
                                    className={`font-bold text-lg ${
                                        isZero ? "text-muted-foreground/40" : "text-secondary"
                                    }`}
                                >
                                    {data.count}
                                </span>
                            </div>
                        );
                    })
                }
                {Object.keys(fillerData).length <= 1 && ( // Account for 'total' key
                    <p className="text-sm text-muted-foreground italic text-center py-4">No words defined</p>
                )}
            </div>
        </div>
    );
};

export default FillerWordsCard;
