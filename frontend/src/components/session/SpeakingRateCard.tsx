import React from 'react';
import { Badge } from '@/components/ui/badge';

interface SpeakingRateCardProps {
    wpm: number;
    wpmLabel: string;
    wpmExplanation?: string;
    className?: string;
}

/**
 * Presentational component displaying the speaking rate (WPM) metric.
 * Extracted from SessionPage for better reusability and testability.
 */
export const SpeakingRateCard: React.FC<SpeakingRateCardProps> = ({
    wpm,
    wpmLabel,
    wpmExplanation,
    className = "",
}) => {
    return (
        <div className={`bg-card border border-border rounded-xl p-4 shadow-card ${className}`}>
            <h3 className="text-base font-semibold text-foreground mb-2">Speaking Pace</h3>
            <div className="bg-slate-50 border border-border/60 rounded-lg p-4 text-center">
                <div
                    data-testid="wpm-value"
                    className="text-3xl font-bold text-foreground mb-0.5"
                >
                    {wpm}
                </div>
                <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">Words Per Minute</p>
                <Badge variant="secondary" className="bg-white text-muted-foreground hover:bg-white border border-border">
                    {wpmLabel || 'Not Measured'}
                </Badge>
                {wpmExplanation && (
                    <p className="text-xs text-muted-foreground leading-snug mt-3" data-testid="wpm-explanation">
                        {wpmExplanation}
                    </p>
                )}
            </div>
        </div>
    );
};

export default SpeakingRateCard;
