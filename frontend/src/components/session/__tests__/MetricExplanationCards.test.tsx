import { render, screen } from '../../../../tests/support/test-utils';
import { describe, expect, it } from 'vitest';
import { ClarityScoreCard } from '../ClarityScoreCard';
import { FillerWordsCard } from '../FillerWordsCard';
import { PauseMetricsDisplay } from '../PauseMetricsDisplay';
import { SpeakingRateCard } from '../SpeakingRateCard';

describe('session metric explanation cards', () => {
    it('shows an unscored clarity state when no transcript was captured', () => {
        render(
            <ClarityScoreCard
                clarityScore={0}
                clarityLabel="Not enough speech to score"
                clarityExplanation="No transcript was captured, so clarity cannot be scored yet."
                isClarityScorable={false}
            />
        );

        expect(screen.getByTestId('clarity-score-value')).toHaveTextContent('--');
        expect(screen.getByText('Not enough speech to score')).toBeInTheDocument();
        expect(screen.getByTestId('clarity-score-explanation')).toHaveTextContent('No transcript was captured');
    });

    it('explains why speaking pace is outside the target range', () => {
        render(
            <SpeakingRateCard
                wpm={174}
                wpmLabel="Too Fast"
                wpmExplanation="You are above the target range; slow slightly so listeners can track each idea."
            />
        );

        expect(screen.getByTestId('wpm-value')).toHaveTextContent('174');
        expect(screen.getByText('Too Fast')).toBeInTheDocument();
        expect(screen.getByTestId('wpm-explanation')).toHaveTextContent('above the target range');
    });

    it('connects filler totals to the captured transcript instead of only listing words', () => {
        render(
            <FillerWordsCard
                fillerCount={3}
                fillerData={{
                    um: { count: 2 },
                    like: { count: 1 },
                    total: { count: 3 },
                }}
                fillerExplanation="3 filler words detected, about 10.0% of captured words."
            />
        );

        expect(screen.getByTestId('filler-count-value')).toHaveTextContent('(3)');
        expect(screen.getByText('"um"')).toBeInTheDocument();
        expect(screen.getByText('"like"')).toBeInTheDocument();
        expect(screen.getByTestId('filler-explanation')).toHaveTextContent('10.0% of captured words');
    });

    it('explains whether pause rhythm is helping or hurting delivery', () => {
        render(
            <PauseMetricsDisplay
                metrics={{
                    totalPauses: 12,
                    pausesPerMinute: 19.9,
                    averagePauseDuration: 1.2,
                    longestPause: 2.4,
                    silencePercentage: 18,
                    transitionPauses: 8,
                    extendedPauses: 4,
                }}
            />
        );

        expect(screen.getByText('Total Pauses')).toBeInTheDocument();
        expect(screen.getByText('19.9')).toBeInTheDocument();
        expect(screen.getByTestId('pause-explanation')).toHaveTextContent('Pause rate is high');
    });
});
