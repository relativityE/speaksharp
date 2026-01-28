import React from 'react';

interface ClarityScoreCardProps {
    clarityScore: number;
    clarityLabel: string;
}

/**
 * Presentational component displaying the clarity score metric.
 * Extracted from SessionPage for better reusability and testability.
 */
export const ClarityScoreCard: React.FC<ClarityScoreCardProps> = ({
    clarityScore,
    clarityLabel,
}) => {
    return (
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-foreground mb-4">Live Stats</h3>
            <div className="bg-muted/30 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-muted-foreground text-sm">Clarity Score</span>
                    <span className="text-primary font-bold">{Math.round(clarityScore)}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden mb-2">
                    <div
                        className="h-full bg-primary rounded-full transition-all duration-300"
                        style={{ width: `${clarityScore}%` }}
                    />
                </div>
                <p className="text-xs text-muted-foreground text-right">
                    {clarityLabel || 'Keep speaking clearly'}
                </p>
            </div>
        </div>
    );
};

export default ClarityScoreCard;
