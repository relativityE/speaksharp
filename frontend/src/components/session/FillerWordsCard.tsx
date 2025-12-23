import React from 'react';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';

interface FillerWordData {
    count: number;
    lastOccurrence?: number;
}

interface FillerWordsCardProps {
    fillerCount: number;
    fillerData: Record<string, FillerWordData>;
}

/**
 * Presentational component displaying the filler words metric.
 * Extracted from SessionPage for better reusability and testability.
 */
export const FillerWordsCard: React.FC<FillerWordsCardProps> = ({
    fillerCount,
    fillerData,
}) => {
    return (
        <div className="bg-card border border-border rounded-lg p-8 shadow-elegant">
            <div className="flex items-center gap-2 mb-6">
                <AlertTriangle className="size-5 text-secondary" />
                <h3 className="text-lg font-semibold text-foreground">Filler Words</h3>
            </div>
            <div className="flex flex-col items-center mb-4">
                <div
                    data-testid="filler-count-value"
                    style={{
                        color: '#f5a623',
                        fontSize: '60px',
                        fontWeight: 700,
                        lineHeight: 1.2,
                        marginBottom: '0.5rem',
                    }}
                >
                    {fillerCount}
                </div>
                <p className="text-sm text-muted-foreground">detected this session</p>
            </div>
            <div className="mt-4">
                <p className="text-xs text-muted-foreground mb-2">Recent:</p>
                <div className="flex flex-wrap gap-2">
                    {Object.entries(fillerData).map(
                        ([word, data]) =>
                            data.count > 0 && (
                                <Badge key={word} variant="outline" className="text-xs bg-muted/50">
                                    "{word}"
                                </Badge>
                            )
                    )}
                    {fillerCount === 0 && (
                        <div className="flex gap-2">
                            <Badge variant="outline" className="text-xs bg-muted/50">
                                "um"
                            </Badge>
                            <Badge variant="outline" className="text-xs bg-muted/50">
                                "uh"
                            </Badge>
                            <Badge variant="outline" className="text-xs bg-muted/50">
                                "like"
                            </Badge>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FillerWordsCard;
