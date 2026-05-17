import { render, screen } from '../../../../tests/support/test-utils';
import { describe, expect, it } from 'vitest';
import { SpeakingTipsCard } from '../SpeakingTipsCard';

describe('SpeakingTipsCard', () => {
  it('does not recommend more pauses when pause frequency is already high', () => {
    render(
      <SpeakingTipsCard
        wpm={130}
        fillerCount={3}
        clarityScore={90}
        pauseMetrics={{
          totalPauses: 12,
          pausesPerMinute: 19.9,
          averagePauseDuration: 1.2,
          longestPause: 2.4,
          silencePercentage: 40,
          transitionPauses: 9,
          extendedPauses: 3,
        }}
      />
    );

    expect(screen.getByText('Group Your Thoughts')).toBeInTheDocument();
    expect(screen.queryByText('Replace Fillers')).not.toBeInTheDocument();
  });
});
