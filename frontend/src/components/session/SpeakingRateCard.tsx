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
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-foreground mb-4">Speaking Pace</h3>
            <div className="bg-muted/30 rounded-xl p-6 text-center">
                <div
                    data-testid="wpm-value"
                    className="text-4xl font-bold text-foreground mb-1"
                >
                    {wpm}
                </div>
                <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">Words Per Minute</p>
                <Badge variant="secondary" className="bg-secondary/10 text-secondary hover:bg-secondary/20 border-none">
                    {wpmLabel || 'Optimal'}
                </Badge>
            </div>
        </div>
    );
};

export default SpeakingRateCard;
