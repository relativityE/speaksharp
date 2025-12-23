import React from 'react';
import { Badge } from '@/components/ui/badge';

interface SpeakingRateCardProps {
    wpm: number;
    wpmLabel: string;
}

/**
 * Presentational component displaying the speaking rate (WPM) metric.
 * Extracted from SessionPage for better reusability and testability.
 */
export const SpeakingRateCard: React.FC<SpeakingRateCardProps> = ({
    wpm,
    wpmLabel,
}) => {
    return (
        <div className="bg-card border border-border rounded-lg p-8 shadow-elegant">
            <h3 className="text-lg font-semibold text-foreground mb-6">Speaking Rate</h3>
            <div className="flex flex-col items-center">
                <div
                    data-testid="wpm-value"
                    style={{
                        color: '#2aa198',
                        fontSize: '60px',
                        fontWeight: 700,
                        lineHeight: 1.2,
                        marginBottom: '0.5rem',
                    }}
                >
                    {wpm}
                </div>
                <p className="text-sm text-muted-foreground mb-3">words per minute</p>
                <Badge className="bg-secondary text-white border-secondary">
                    {wpmLabel || 'Optimal Range'}
                </Badge>
            </div>
        </div>
    );
};

export default SpeakingRateCard;
