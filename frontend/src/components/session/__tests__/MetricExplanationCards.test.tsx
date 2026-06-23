import { render, screen } from '../../../../tests/support/test-utils';
import { describe, expect, it } from 'vitest';
import { FillerWordsCard } from '../FillerWordsCard';
import { PauseMetricsDisplay } from '../PauseMetricsDisplay';

describe('session metric explanation cards', () => {
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
        expect(screen.getByText('um')).toBeInTheDocument();
        expect(screen.getByText('like')).toBeInTheDocument();
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
