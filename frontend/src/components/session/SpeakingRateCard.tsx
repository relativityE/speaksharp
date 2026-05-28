import React from 'react';
import { Badge } from '@/components/ui/badge';
import { SESSION_INSET_SURFACE_CLASS, SESSION_SURFACE_CLASS } from './sessionSurface';

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
        <div className={`${SESSION_SURFACE_CLASS} p-4 ${className}`}>
            <h3 className="text-base font-semibold text-foreground mb-2">Speaking Pace</h3>
            <div className={`${SESSION_INSET_SURFACE_CLASS} p-4 text-center`}>
                <div
                    data-testid="wpm-value"
                    className="text-3xl font-bold text-foreground mb-0.5"
                >
                    {wpm}
                </div>
                <p className="mb-3 text-xs font-bold uppercase tracking-wider text-foreground/70">Words Per Minute</p>
                <Badge variant="secondary" className="bg-white text-foreground/80 hover:bg-white border border-[hsl(var(--border-strong))]">
                    {wpmLabel || 'Not Measured'}
                </Badge>
                {wpmExplanation && (
                    <p className="mt-3 text-xs font-medium leading-snug text-foreground/70" data-testid="wpm-explanation">
                        {wpmExplanation}
                    </p>
                )}
            </div>
        </div>
    );
};

export default SpeakingRateCard;
