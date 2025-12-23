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

const TipCard: React.FC<SpeakingTip> = ({ title, description }) => (
    <div className="p-3 rounded-lg bg-card/80 border border-white/15 shadow-sm">
        <h4 className="font-semibold text-foreground mb-1 text-sm">{title}</h4>
        <p className="text-xs text-muted-foreground">{description}</p>
    </div>
);

/**
 * Presentational component for speaking tips.
 * Extracted from SessionPage for better reusability and testability.
 */
export const SpeakingTipsCard: React.FC<SpeakingTipsCardProps> = ({
    tips = defaultTips,
}) => {
    return (
        <div className="bg-card border border-border rounded-lg p-8 shadow-elegant">
            <div className="flex items-center gap-2 mb-6">
                <Lightbulb className="size-5 text-secondary" />
                <h3 className="text-lg font-semibold text-foreground">Speaking Tips</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {tips.map((tip) => (
                    <TipCard key={tip.title} title={tip.title} description={tip.description} />
                ))}
            </div>
        </div>
    );
};

export default SpeakingTipsCard;
