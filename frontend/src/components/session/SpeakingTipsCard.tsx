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
}

// Unused TipCard component removed as content is inlined below

/**
 * Presentational component for speaking tips.
 * Extracted from SessionPage for better reusability and testability.
 */
export const SpeakingTipsCard: React.FC<SpeakingTipsCardProps> = ({
    tips = defaultTips,
}) => {
    // Select a random tip on mount (stable for session)
    const [tip] = React.useState(() => tips[Math.floor(Math.random() * tips.length)]);

    return (
        <div className="bg-secondary/10 border border-secondary/30 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-secondary mb-2 flex items-center gap-2">
                <Lightbulb className="h-5 w-5" />
                Quick Tip
            </h2>
            <div className="space-y-1">
                <h4 className="font-medium text-foreground text-sm">{tip.title}</h4>
                <p className="text-muted-foreground text-sm leading-relaxed">
                    {tip.description}
                </p>
            </div>
        </div>
    );
};

export default SpeakingTipsCard;
