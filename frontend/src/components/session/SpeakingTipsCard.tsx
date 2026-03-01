import React from 'react';
import { Lightbulb } from 'lucide-react';

interface SpeakingTip {
    title: string;
    description: string;
}

const defaultTips: SpeakingTip[] = [
    {
        title: 'Pace Yourself',
        description: 'Maintain 120-160 words per minute for optimal clarity',
    },
    {
        title: 'Pause Instead',
        description: 'Use intentional pauses instead of filler words',
    },
    {
        title: 'Practice Daily',
        description: 'Regular practice builds confident speaking habits',
    },
];

interface SpeakingTipsCardProps {
    tips?: SpeakingTip[];
    className?: string;
}

// Unused TipCard component removed as content is inlined below

/**
 * Presentational component for speaking tips.
 * Extracted from SessionPage for better reusability and testability.
 */
export const SpeakingTipsCard: React.FC<SpeakingTipsCardProps> = ({
    tips = defaultTips,
    className = "",
}) => {
    // Select a random tip on mount (stable for session)
    const [tip] = React.useState(() => tips[Math.floor(Math.random() * tips.length)]);

    const isCompact = className.includes('compact');

    return (
        <div className={`bg-secondary/10 border border-secondary/30 rounded-xl ${isCompact ? 'p-3' : 'p-6'} shadow-sm ${className}`}>
            <h2 className={`${isCompact ? 'text-base' : 'text-lg'} font-semibold text-secondary ${isCompact ? 'mb-1' : 'mb-2'} flex items-center gap-2`}>
                <Lightbulb className={`${isCompact ? 'h-4 w-4' : 'h-5 w-5'}`} />
                Quick Tip
            </h2>
            <div className="space-y-0.5">
                <h4 className="font-medium text-foreground text-sm">{tip.title}</h4>
                <p className="text-muted-foreground text-sm leading-relaxed">
                    {tip.description}
                </p>
            </div>
        </div>
    );
};

export default SpeakingTipsCard;
