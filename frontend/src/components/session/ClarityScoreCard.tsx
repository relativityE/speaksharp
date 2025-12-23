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
        <div className="bg-card border border-border rounded-lg p-8 shadow-elegant">
            <h3 className="text-lg font-semibold text-foreground mb-6">Clarity Score</h3>
            <div className="flex flex-col items-center">
                <div
                    data-testid="clarity-score-value"
                    style={{
                        color: '#2aa198',
                        fontSize: '60px',
                        fontWeight: 700,
                        lineHeight: 1.2,
                        marginBottom: '1rem',
                    }}
                >
                    {Math.round(clarityScore)}%
                </div>
                {/* Progress bar - teal filled, orange remaining */}
                <div className="w-full h-3 rounded-full overflow-hidden flex bg-secondary mb-3">
                    <div
                        className="h-full bg-accent transition-all duration-300"
                        style={{ width: `${clarityScore}%` }}
                    />
                </div>
                <p className="text-sm text-muted-foreground">
                    {clarityLabel || 'Excellent clarity!'}
                </p>
            </div>
        </div>
    );
};

export default ClarityScoreCard;
