import React from 'react';
import { AlertTriangle } from 'lucide-react';
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
        <div className="bg-card border border-border rounded-lg p-8 shadow-elegant">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-amber-500/10 rounded-full">
                        <AlertTriangle className="size-5 text-amber-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-foreground">Filler Words</h3>
                </div>
                {headerAction}
            </div>
            <div className="flex flex-col items-center mb-4">
                <p className="text-lg text-muted-foreground capitalize tracking-wide font-extrabold mb-2">Total Detected</p>
                <div
                    data-testid="filler-count-value"
                    style={{
                        color: '#f5a623',
                        fontSize: '60px',
                        fontWeight: 700,
                        lineHeight: 1,
                    }}
                >
                    {fillerCount}
                </div>
            </div>
            <div className="mt-4 w-full">
                <div data-testid="filler-words-list" className="flex flex-wrap gap-3 justify-center">
                    {Object.entries(fillerData)
                        .filter(([key]) => key !== 'total') // SHOW ALL VALUES, even 0
                        .sort(([, a], [, b]) => b.count - a.count)
                        .map(([word, data]) => {
                            const color = getWordColor(word);
                            // Visual dimming for 0 counts
                            const isZero = data.count === 0;
                            const opacity = isZero ? '0.5' : '1';

                            return (
                                <div
                                    key={word}
                                    data-testid="filler-badge"
                                    data-word={word}
                                    className="py-2 px-3 flex flex-col items-center justify-center gap-1 transition-all hover:scale-105 min-w-[70px] min-h-[60px]"
                                    style={{
                                        opacity
                                    }}
                                >
                                    <span
                                        data-testid="filler-badge-count"
                                        style={{ color: isZero ? 'inherit' : color }}
                                        className="font-bold text-3xl leading-none"
                                    >
                                        {isZero ? '-' : data.count}
                                    </span>
                                    <span
                                        className="text-sm capitalize tracking-wide text-center truncate max-w-[100px] font-extrabold text-amber-500"
                                    >
                                        {word}
                                    </span>
                                </div>
                            );
                        })
                    }
                    {Object.keys(fillerData).length === 0 && (
                        <p className="text-sm text-muted-foreground italic">No filler words defined.</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FillerWordsCard;
