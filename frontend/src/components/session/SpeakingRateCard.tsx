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
        <div className="glass rounded-xl p-4 text-center flex flex-col justify-center">
            <h3 className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wider">Speaking Pace</h3>
            <div
                data-testid="wpm-value"
                className="text-4xl font-bold text-primary"
            >
                {wpm}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
                Words Per Minute
            </p>
            {wpmLabel && (
                <div className="mt-3">
                     <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20 border-none text-[10px] h-5 px-2">
                        {wpmLabel}
                    </Badge>
                </div>
            )}
        </div>
    );
};

export default SpeakingRateCard;
