import React from 'react';
import { Lightbulb } from 'lucide-react';
import type { PauseMetrics } from '@/services/audio/pauseDetector';

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
    wpm?: number;
    fillerCount?: number;
    clarityScore?: number;
    pauseMetrics?: PauseMetrics;
    className?: string;
}

// Unused TipCard component removed as content is inlined below

/**
 * Presentational component for speaking tips.
 * Extracted from SessionPage for better reusability and testability.
 */
export const SpeakingTipsCard: React.FC<SpeakingTipsCardProps> = ({
    tips = defaultTips,
    wpm = 0,
    fillerCount = 0,
    clarityScore = 100,
    pauseMetrics,
    className = "",
}) => {
    const tip = React.useMemo<SpeakingTip>(() => {
        if (wpm > 160) {
            return {
                title: 'Slow Down',
                description: 'Your pace is running fast. Add a beat between key ideas so listeners can keep up.',
            };
        }

        if (wpm > 0 && wpm < 110) {
            return {
                title: 'Add Energy',
                description: 'Your pace is relaxed. Try a little more momentum while keeping your pauses intentional.',
            };
        }

        if ((pauseMetrics?.totalPauses ?? 0) === 0 && wpm > 0) {
            return {
                title: 'Use Pauses',
                description: 'No meaningful pauses have been detected yet. Pause briefly after important points.',
            };
        }

        if (fillerCount > 0) {
            return {
                title: 'Replace Fillers',
                description: `We detected ${fillerCount} filler${fillerCount === 1 ? '' : 's'}. Try replacing one with a short pause.`,
            };
        }

        if (clarityScore < 80) {
            return {
                title: 'Tighten Clarity',
                description: 'Focus on shorter phrases and cleaner endings for the next run.',
            };
        }

        return tips[0] ?? defaultTips[0];
    }, [clarityScore, fillerCount, pauseMetrics?.totalPauses, tips, wpm]);

    const isCompact = className.includes('compact');

    return (
        <div className={`bg-secondary/10 border border-border rounded-xl ${isCompact ? 'p-3' : 'p-6'} shadow-card ${className}`}>
            <h2 className={`${isCompact ? 'text-base' : 'text-lg'} font-semibold text-muted-foreground ${isCompact ? 'mb-1' : 'mb-2'} flex items-center gap-2`}>
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
