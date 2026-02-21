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
        <div className="glass rounded-2xl p-6 shadow-sm">
            <h3 className="text-base font-semibold text-foreground mb-4">Clarity</h3>
            <div className="space-y-4">
                <div className="flex items-center justify-between mb-1">
                    <span className="text-muted-foreground text-sm">Score</span>
                    <span className="text-primary font-bold" data-testid="clarity-score-value">{Math.round(clarityScore)}%</span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-primary rounded-full transition-all duration-300"
                        style={{ width: `${clarityScore}%` }}
                    />
                </div>
                <p className="text-xs text-muted-foreground text-right mt-2">
                    {clarityLabel || 'Keep speaking clearly'}
                </p>
            </div>
        </div>
    );
};

export default ClarityScoreCard;
