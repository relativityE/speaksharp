import React from 'react';

interface ClarityScoreCardProps {
    clarityScore: number;
    clarityLabel: string;
    clarityExplanation?: string;
    isClarityScorable?: boolean;
    className?: string;
}

/**
 * Presentational component displaying the clarity score metric.
 * Extracted from SessionPage for better reusability and testability.
 */
export const ClarityScoreCard: React.FC<ClarityScoreCardProps> = ({
    clarityScore,
    clarityLabel,
    clarityExplanation,
    isClarityScorable = true,
    className = "",
}) => {
    const displayScore = isClarityScorable ? Math.round(clarityScore) : 0;
    const barWidth = Math.max(0, Math.min(100, displayScore));

    return (
        <div className={`bg-card border border-border rounded-xl p-4 shadow-card ${className}`}>
            <h3 className="text-base font-semibold text-foreground mb-2">Speech Clarity</h3>
            <div className="bg-slate-50 border border-border/60 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                    <span className="text-muted-foreground text-sm font-medium">Clarity Score</span>
                    <span className="text-primary font-bold" data-testid="clarity-score-value">
                        {isClarityScorable ? `${displayScore}%` : '--'}
                    </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden mb-2">
                    <div
                        className="h-full bg-primary rounded-full transition-all duration-300"
                        style={{ width: `${barWidth}%` }}
                    />
                </div>
                <p className="text-xs text-muted-foreground text-right mb-1">
                    {clarityLabel || 'Not measured yet'}
                </p>
                {clarityExplanation && (
                    <p className="text-xs text-muted-foreground leading-snug text-right" data-testid="clarity-score-explanation">
                        {clarityExplanation}
                    </p>
                )}
            </div>
        </div>
    );
};

export default ClarityScoreCard;
