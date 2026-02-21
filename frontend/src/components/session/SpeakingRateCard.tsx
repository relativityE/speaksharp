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
        <div className="glass rounded-xl p-4 text-center shadow-sm flex flex-col items-center justify-center">
            <div
                data-testid="wpm-value"
                className="text-2xl font-bold text-primary"
            >
                {wpm}
            </div>
            <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">WPM</p>
            <div className="mt-2">
                <Badge variant="secondary" className="bg-secondary/10 text-secondary hover:bg-secondary/20 border-none text-[10px] px-2 py-0">
                    {wpmLabel || 'Optimal'}
                </Badge>
            </div>
        </div>
    );
};

export default SpeakingRateCard;
