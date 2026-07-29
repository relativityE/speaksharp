import { fireEvent, render, screen } from '../../../../tests/support/test-utils';
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

    it('keeps score explanations out of the default view and behind accessible help', () => {
        render(
            <LiveCoachingScoreCard
                transcript="Today I want to make one clear point because the team needs a simple plan with one concrete example."
                // Past the warming-up floor on purpose: this test is about help-vs-default visibility,
                // and #1047 collapses the genuinely-empty state down to a single panel (covered below).
                wordCount={30}
                wpm={145}
                clarityScore={88}
                fillerCount={1}
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
                engine="native"
                isListening
                experimentAssignment={assignment}
            />
        );

        // Visible by default: heading, score value, confidence chip, and the "Try this now" actions.
        // #1047: the card is labelled "Session feedback" — never "SpeakSharp Progress" (Progress does
        // not exist yet and the label must not promise it) and never with the orphaned asterisk.
        expect(screen.getByText('Session feedback')).toBeInTheDocument();
        expect(screen.queryByText(/SpeakSharp Progress/i)).toBeNull();
        expect(screen.queryByText('SpeakSharp Score*')).toBeNull();
        expect(screen.getByTestId('live-session-score')).toBeInTheDocument();
        expect(screen.getByTestId('live-score-confidence')).toBeInTheDocument();
        expect(screen.getByText('Try this now')).toBeInTheDocument();

        // The wordy explanation, breakdown, and footnote are NOT default-visible.
        expect(screen.queryByText(/visible tools roll up into one coaching score/i)).toBeNull();
        expect(screen.queryByText(/Improve the ingredients/i)).toBeNull();
        expect(screen.queryByText('Why this score moved')).toBeNull();
        expect(screen.queryByText(/not a black box/i)).toBeNull();
        expect(screen.queryByText(/SpeakSharp Score is a directional practice signal/i)).toBeNull();
        // Canonical naming: Audience Impact, never Listener Takeaway.
        expect(screen.queryByText(/Listener Takeaway/i)).toBeNull();

        // ...but they remain available through the accessible help affordance.
        const helpTrigger = screen.getByTestId('score-help');
        expect(helpTrigger).toBeInTheDocument();
        fireEvent.click(helpTrigger);

        expect(screen.getByText(/visible tools roll up into one coaching score/i)).toBeInTheDocument();
        expect(screen.getByText(/Improve the ingredients/i)).toBeInTheDocument();
        expect(screen.getByText('Why this score moved')).toBeInTheDocument();
        expect(screen.getByTestId('live-score-evidence')).toHaveTextContent('Structure from transcript');
        expect(screen.getByTestId('live-score-evidence')).toHaveTextContent('Pace, fillers, pauses');
        expect(screen.getByTestId('live-score-evidence')).toHaveTextContent('Clarity signal');
        expect(screen.getByTestId('live-score-evidence')).toHaveTextContent('Audience Impact');
        expect(screen.getByText(/not a black box/i)).toBeInTheDocument();
        expect(screen.getByText(/SpeakSharp Score is a directional practice signal/i)).toBeInTheDocument();
    });

    // #1047 focused coverage.
    const emptyPauseMetrics = {
        totalPauses: 0, pausesPerMinute: 0, averagePauseDuration: 0,
        longestPause: 0, silencePercentage: 0, transitionPauses: 0, extendedPauses: 0,
    };

    it('#1047: states "no score yet" exactly ONCE before there is a signal', () => {
        render(
            <LiveCoachingScoreCard
                transcript=""
                wordCount={0}
                wpm={0}
                clarityScore={0}
                fillerCount={0}
                elapsedSeconds={0}
                pauseMetrics={emptyPauseMetrics}
                engine="native"
                isListening={false}
                experimentAssignment={assignment}
            />
        );

        // ONE panel carries the whole message: label, `--`, one hint.
        expect(screen.getByTestId('live-score-empty-panel')).toBeInTheDocument();
        expect(screen.getAllByText('--')).toHaveLength(1);
        expect(screen.getByTestId('live-score-empty-hint')).toHaveTextContent('Speak ~30s to see progress');

        // The three other simultaneous "no data" statements are gone.
        expect(screen.queryByText(/score soon/i)).toBeNull();
        expect(screen.queryByTestId('live-score-headline')).toBeNull();
        expect(screen.queryByTestId('live-score-confidence')).toBeNull();
    });

    it('#1047: shows NO numbered guidance when no evidence supports it', () => {
        render(
            <LiveCoachingScoreCard
                transcript=""
                wordCount={0}
                wpm={0}
                clarityScore={0}
                fillerCount={0}
                elapsedSeconds={0}
                pauseMetrics={emptyPauseMetrics}
                engine="native"
                isListening={false}
                experimentAssignment={assignment}
            />
        );

        expect(screen.queryByTestId('live-coaching-actions')).toBeNull();
        expect(screen.queryByText('Try this now')).toBeNull();
        // …and specifically none of the generic openers the score module falls back to.
        expect(screen.queryByText(/Start with one complete thought/i)).toBeNull();
        expect(screen.queryByText(/Say the main point before the context/i)).toBeNull();
    });

    it('#1047: renders guidance as a NUMBERED list once evidence exists', () => {
        render(
            <LiveCoachingScoreCard
                transcript="The point is simple. First, practice privately because it builds confidence. For example, one focused rehearsal makes the next meeting easier."
                wordCount={90}
                wpm={200}
                clarityScore={70}
                fillerCount={12}
                elapsedSeconds={60}
                pauseMetrics={emptyPauseMetrics}
                engine="cloud"
                isListening
                experimentAssignment={assignment}
            />
        );

        const actions = screen.getByTestId('live-coaching-actions');
        expect(actions.tagName).toBe('OL');
        expect(screen.queryByTestId('live-coaching-no-evidence')).toBeNull();
    });

    it('#1047: the card sizes to its content and never stretches to the neighbouring column', () => {
        render(
            <LiveCoachingScoreCard
                transcript=""
                wordCount={0}
                wpm={0}
                clarityScore={0}
                fillerCount={0}
                elapsedSeconds={0}
                pauseMetrics={emptyPauseMetrics}
                engine="native"
                isListening={false}
                experimentAssignment={assignment}
                className="self-start"
            />
        );

        const card = screen.getByTestId('live-coaching-score-card');
        expect(card).toHaveClass('self-start');
        expect(card).not.toHaveClass('self-stretch');
        expect(card).not.toHaveClass('h-full');
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
        // The trust caveat now lives in help (not a default-visible paragraph).
        expect(screen.queryByText(/Transcript quality .* affects how confidently the score is shown/i)).toBeNull();
        fireEvent.click(screen.getByTestId('score-help'));
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
        // Native is capped at directional (no precise number); the filler caveat lives in help.
        expect(screen.getByTestId('live-session-score')).toHaveTextContent('--');
        expect(screen.queryByTestId('live-score-quality-caveat')).toBeNull();
        fireEvent.click(screen.getByTestId('score-help'));
        expect(screen.getByTestId('live-score-quality-caveat')).toHaveTextContent(/filler/i);
    });

    it('shows a prominent, color-coded confidence chip the user cannot miss', () => {
        const nativeTranscript = Array.from({ length: 6 }, () => Array(15).fill('word').join(' ')).join('. ') + '.';
        const { rerender } = render(
            <LiveCoachingScoreCard
                transcript={nativeTranscript}
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
        // Native (filler-recall untrusted) -> directional confidence chip, marked untrusted.
        const directionalChip = screen.getByTestId('live-score-confidence');
        expect(directionalChip).toHaveTextContent(/Confidence: Directional/i);
        expect(directionalChip).toHaveAttribute('data-score-confidence', 'directional');
        expect(directionalChip).toHaveAttribute('data-transcript-trusted', 'false');

        // Clean Cloud sample -> high-confidence chip, marked trusted.
        const cleanTranscript = [
            'The point is simple.',
            'First, practice privately because it builds confidence.',
            'For example, one focused rehearsal makes the next meeting easier.',
            'The takeaway is that steady practice improves delivery.',
        ].join(' ');
        rerender(
            <LiveCoachingScoreCard
                transcript={cleanTranscript}
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
        const highChip = screen.getByTestId('live-score-confidence');
        expect(highChip).toHaveTextContent(/Confidence: High/i);
        expect(highChip).toHaveAttribute('data-score-confidence', 'usable');
        expect(highChip).toHaveAttribute('data-transcript-trusted', 'true');
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
