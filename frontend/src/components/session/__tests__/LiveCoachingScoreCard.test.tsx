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
        source: 'default' as const,
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

        expect(screen.getByText('SpeakSharp Score*')).toBeInTheDocument();
        expect(screen.getByText(/visible tools roll up into one coaching score/i)).toBeInTheDocument();
        expect(screen.getByText(/Improve the ingredients/i)).toBeInTheDocument();
        expect(screen.getByText('Why this score moved')).toBeInTheDocument();
        expect(screen.getByTestId('live-score-evidence')).toHaveTextContent('Structure from transcript');
        expect(screen.getByTestId('live-score-evidence')).toHaveTextContent('Pace, fillers, pauses');
        expect(screen.getByTestId('live-score-evidence')).toHaveTextContent('Clarity signal');
        expect(screen.getByText(/not a black box/i)).toBeInTheDocument();
        expect(screen.getByText(/transparent rollup of the live signals/i)).toBeInTheDocument();
        expect(screen.getByText(/SpeakSharp Score is a directional practice signal/i)).toBeInTheDocument();
        expect(screen.getByText(/progress over time matters more than one exact number/i)).toBeInTheDocument();
    });

    it('does not show a precise numeric score while the signal is only directional', () => {
        render(
            <LiveCoachingScoreCard
                transcript={Array(90).fill('word').join(' ')}
                wordCount={90}
                wpm={140}
                clarityScore={90}
                fillerCount={0}
                elapsedSeconds={45}
                pauseMetrics={{
                    totalPauses: 2,
                    pausesPerMinute: 4,
                    averagePauseDuration: 0.9,
                    longestPause: 1.2,
                    silencePercentage: 12,
                    transitionPauses: 2,
                    extendedPauses: 0,
                }}
                engine="private"
                isListening
                experimentAssignment={assignment}
            />
        );

        expect(screen.getByTestId('live-session-score')).toHaveTextContent('--');
        expect(screen.getAllByText('Early signal').length).toBeGreaterThan(0);
    });

    it('shows a numeric score only once transcript confidence is usable', () => {
        const transcript = [
            'The point is simple.',
            'First, practice privately because it builds confidence.',
            'For example, one focused rehearsal makes the next meeting easier.',
            'The takeaway is that steady practice improves delivery.',
        ].join(' ');

        render(
            <LiveCoachingScoreCard
                transcript={transcript}
                wordCount={90}
                wpm={140}
                clarityScore={90}
                fillerCount={0}
                elapsedSeconds={45}
                pauseMetrics={{
                    totalPauses: 2,
                    pausesPerMinute: 4,
                    averagePauseDuration: 0.9,
                    longestPause: 1.2,
                    silencePercentage: 12,
                    transitionPauses: 2,
                    extendedPauses: 0,
                }}
                engine="private"
                isListening
                experimentAssignment={assignment}
            />
        );

        expect(screen.getByTestId('live-session-score')).not.toHaveTextContent('--');
        expect(screen.getByText('out of 10')).toBeInTheDocument();
    });

    it('always states that transcript quality affects how confidently the score is shown', () => {
        render(
            <LiveCoachingScoreCard
                transcript="Today I want to make one clear point because the team needs a simple plan."
                wordCount={20}
                wpm={140}
                clarityScore={88}
                fillerCount={1}
                elapsedSeconds={25}
                pauseMetrics={{
                    totalPauses: 2, pausesPerMinute: 4, averagePauseDuration: 0.9,
                    longestPause: 1.2, silencePercentage: 12, transitionPauses: 2, extendedPauses: 0,
                }}
                engine="cloud"
                isListening
                experimentAssignment={assignment}
            />
        );
        expect(screen.getByText(/Transcript quality .* affects how confidently the score is shown/i)).toBeInTheDocument();
    });

    it('shows a transcript-quality caveat for a long Native sample (filler recall not trusted)', () => {
        const transcript = Array.from({ length: 6 }, () => Array(15).fill('word').join(' ')).join('. ') + '.';
        render(
            <LiveCoachingScoreCard
                transcript={transcript}
                wordCount={90}
                wpm={140}
                clarityScore={90}
                fillerCount={0}
                elapsedSeconds={45}
                pauseMetrics={{
                    totalPauses: 2, pausesPerMinute: 4, averagePauseDuration: 0.9,
                    longestPause: 1.2, silencePercentage: 12, transitionPauses: 2, extendedPauses: 0,
                }}
                engine="native"
                isListening
                experimentAssignment={assignment}
            />
        );
        // Native is capped at directional (no precise number) and shows the filler caveat.
        expect(screen.getByTestId('live-session-score')).toHaveTextContent('--');
        expect(screen.getByTestId('live-score-quality-caveat')).toHaveTextContent(/filler/i);
    });

    it('does not show a transcript-quality caveat for a clean usable Cloud sample', () => {
        const transcript = [
            'The point is simple.',
            'First, practice privately because it builds confidence.',
            'For example, one focused rehearsal makes the next meeting easier.',
            'The takeaway is that steady practice improves delivery.',
        ].join(' ');
        render(
            <LiveCoachingScoreCard
                transcript={transcript}
                wordCount={90}
                wpm={140}
                clarityScore={90}
                fillerCount={0}
                elapsedSeconds={45}
                pauseMetrics={{
                    totalPauses: 2, pausesPerMinute: 4, averagePauseDuration: 0.9,
                    longestPause: 1.2, silencePercentage: 12, transitionPauses: 2, extendedPauses: 0,
                }}
                engine="cloud"
                isListening
                experimentAssignment={assignment}
            />
        );
        expect(screen.queryByTestId('live-score-quality-caveat')).not.toBeInTheDocument();
        expect(screen.getByText('out of 10')).toBeInTheDocument();
    });
});
