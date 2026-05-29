import { render, screen } from '../../../../tests/support/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { LiveCoachingScoreCard } from '../LiveCoachingScoreCard';
import { SESSION_COACHING_EXPERIMENT_FLAG } from '@/services/sessionCoachingExperiment';

vi.mock('@/services/sessionCoachingExperiment', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/sessionCoachingExperiment')>();
    return {
        ...actual,
        trackSessionCoachingCardViewed: vi.fn(),
        trackSessionCoachingNumericScoreShown: vi.fn(),
    };
});

describe('LiveCoachingScoreCard', () => {
    const assignment = {
        variant: 'treatment' as const,
        source: 'url' as const,
        flag: SESSION_COACHING_EXPERIMENT_FLAG,
    };

    it('explains that live analytics roll up into the SpeakSharp Score', () => {
        render(
            <LiveCoachingScoreCard
                transcript="Today I want to make one clear point because the team needs a simple plan with one concrete example."
                wordCount={20}
                wpm={145}
                clarityScore={88}
                fillerCount={1}
                elapsedSeconds={25}
                pauseMetrics={{
                    totalPauses: 2,
                    pausesPerMinute: 4,
                    averagePauseDuration: 0.9,
                    longestPause: 1.2,
                    silencePercentage: 12,
                    transitionPauses: 2,
                    extendedPauses: 0,
                }}
                engine="native"
                isListening
                experimentAssignment={assignment}
            />
        );

        expect(screen.getByText('SpeakSharp Score')).toBeInTheDocument();
        expect(screen.getByText(/visible tools roll up into one directional game score/i)).toBeInTheDocument();
        expect(screen.getByText('Why this score moved')).toBeInTheDocument();
        expect(screen.getByTestId('live-score-evidence')).toHaveTextContent('Structure from transcript');
        expect(screen.getByTestId('live-score-evidence')).toHaveTextContent('Pace, fillers, pauses');
        expect(screen.getByTestId('live-score-evidence')).toHaveTextContent('Clarity signal');
        expect(screen.getByText(/not a black box/i)).toBeInTheDocument();
        expect(screen.getByText(/gamified rollup of the live signals/i)).toBeInTheDocument();
    });
});
