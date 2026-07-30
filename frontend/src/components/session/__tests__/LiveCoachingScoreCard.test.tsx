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
        // #1047 NAMING (settled): the surface is "Progress" — carried ONCE by the panel label, never
        // not exist yet and the label must not promise it) and never with the orphaned asterisk.
        expect(screen.getByTestId('live-score-panel-label')).toHaveTextContent('PROGRESS');
        expect(screen.queryByText(/SpeakSharp/i)).toBeNull();
        expect(screen.queryByText('SpeakSharp Score*')).toBeNull();
        expect(screen.getByTestId('live-session-score')).toBeInTheDocument();
        expect(screen.getByTestId('live-score-confidence')).toBeInTheDocument();
        expect(screen.getByText('Try this now')).toBeInTheDocument();

        // The explanation and breakdown are NOT default-visible.
        expect(screen.queryByText(/Pace, detected fillers, delivery signals/i)).toBeNull();
        expect(screen.queryByText(/Progress is directional/i)).toBeNull();
        expect(screen.queryByText('What this is based on')).toBeNull();
        expect(screen.queryByText(/not a black box/i)).toBeNull();
        // Canonical naming: Audience Impact, never Listener Takeaway.
        expect(screen.queryByText(/Listener Takeaway/i)).toBeNull();

        // ...but they remain available through the accessible help affordance.
        const helpTrigger = screen.getByTestId('score-help');
        expect(helpTrigger).toHaveAccessibleName('About progress');
        fireEvent.click(helpTrigger);

        // #1047: the help TEACHES session feedback, in the approved neutral wording.
        expect(screen.getByText('Pace, detected fillers, delivery signals, and transcript quality support your progress.')).toBeInTheDocument();
        expect(screen.getByText('Progress is directional and uses only the practice evidence available for this session.')).toBeInTheDocument();
        expect(screen.getByText('What this is based on')).toBeInTheDocument();
        expect(screen.getByTestId('live-score-evidence')).toHaveTextContent('Structure from transcript');
        expect(screen.getByTestId('live-score-evidence')).toHaveTextContent('Pace, fillers, pauses');
        expect(screen.getByTestId('live-score-evidence')).toHaveTextContent('Clarity signal');
        expect(screen.getByTestId('live-score-evidence')).toHaveTextContent('Audience Impact');
        expect(screen.getByText(/not a black box/i)).toBeInTheDocument();

        // The retired name is gone from the OPENED help, and so is the promise that one coaching
        // score carries over into Analytics. An earlier pass renamed only the label and shipped a
        // body that still taught "SpeakSharp Score" — asserting the heading alone cleared that bar.
        expect(screen.queryByText(/SpeakSharp Score/i)).toBeNull();
        expect(screen.queryByText(/one coaching score/i)).toBeNull();
        expect(screen.queryByText(/Improve the ingredients/i)).toBeNull();
        expect(screen.getByTestId('score-help-content').textContent).not.toMatch(/SpeakSharp Score/i);
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
        // The hint names NO duration — the real gate is word count (MIN_WORDS_FOR_DIRECTIONAL = 25), so
        // any time figure would be fabricated. "Progress" IS now the settled surface name, so the hint
        // may use it; what it may not do is invent a threshold.
        expect(screen.getByTestId('live-score-empty-hint'))
            .toHaveTextContent('Speak a little more to see progress.');
        expect(screen.queryByText(/\d+\s*s(ec|econds)?\b/i)).toBeNull();
        expect(screen.queryByText(/SpeakSharp/i)).toBeNull();

        // The three other simultaneous "no data" statements are gone.
        expect(screen.queryByText(/score soon/i)).toBeNull();
        expect(screen.queryByTestId('live-score-headline')).toBeNull();
        expect(screen.queryByTestId('live-score-confidence')).toBeNull();
    });

    // The generic openers (`calculateSpeakingScore` emits these below MIN_RELIABLE_SCORING_WORDS = 3)
    // are advice invented from nothing. They must be unreachable on screen at EVERY word count — which
    // the empty-signal collapse guarantees, since leaving 'warming-up' needs 25 words. Swept across the
    // whole range rather than probed at one convenient value: an earlier version of this test used
    // wordCount 0, which hit the empty panel and passed without ever exercising the guarantee.
    const renderAtWordCount = (wordCount: number) => render(
        <LiveCoachingScoreCard
            transcript={Array(wordCount).fill('word').join(' ')}
            wordCount={wordCount}
            wpm={120}
            clarityScore={80}
            fillerCount={0}
            elapsedSeconds={40}
            pauseMetrics={emptyPauseMetrics}
            engine="native"
            isListening={false}
            experimentAssignment={assignment}
        />
    );

    // Below the 25-word directional floor the guidance BLOCK still renders — header, and footer — because
    // the Product Owner's spec requires the card to have that structure rather than being a bare `--`.
    // What is gated is the CONTENT: `calculateSpeakingScore` falls back to generic openers below the
    // floor ("Start with one complete thought."), and advice invented from nothing must never be
    // numbered and presented as if it were about this take. So the slot carries an honest
    // insufficient-evidence line instead.
    it.each([0, 1, 2, 3, 4, 10, 24])(
        '#1047: renders the guidance block but NO invented advice below the directional floor (wordCount %i)',
        (wordCount) => {
            renderAtWordCount(wordCount);

            // The generic openers never reach the user.
            expect(screen.queryByText(/Start with one complete thought/i)).toBeNull();
            expect(screen.queryByTestId('live-coaching-actions')).toBeNull();

            // The block itself is present, with the honest state in the slot.
            expect(screen.getByText('Try this now')).toBeInTheDocument();
            expect(screen.getByTestId('live-coaching-no-evidence')).toHaveTextContent(
                'Coaching appears here once you have spoken enough for it to be based on this session.'
            );
            expect(screen.getByTestId('live-score-empty-panel')).toBeInTheDocument();
        }
    );

    it.each([25, 40, 90])(
        '#1047: shows guidance derived from real signals above the floor (wordCount %i)',
        (wordCount) => {
            renderAtWordCount(wordCount);

            expect(screen.getByTestId('live-coaching-actions')).toBeInTheDocument();
            expect(screen.queryByText(/Start with one complete thought/i)).toBeNull();
        }
    );

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

    // NOTE: whether the card stretches is decided by what SessionPage passes, so asserting it here —
    // against a className this test itself supplies — would prove nothing. It is covered where the
    // contract actually lives, in SessionPage.simplify1047.component.test.tsx.

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

    it('always states that transcript quality feeds the feedback, and that it is directional', () => {
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
        // The trust caveat lives in help (not a default-visible paragraph). #1047 restates it in the
        // neutral wording: transcript quality is named as an input, and the feedback is called
        // directional and scoped to this session's own evidence.
        expect(screen.queryByText(/transcript quality/i)).toBeNull();
        fireEvent.click(screen.getByTestId('score-help'));

        const help = screen.getByTestId('score-help-content');
        expect(help.textContent).toMatch(/transcript quality support your progress/i);
        expect(help.textContent).toMatch(/directional and uses only the practice evidence available for this session/i);
        // …and it says so without reviving the retired product name.
        expect(help.textContent).not.toMatch(/SpeakSharp Score/i);
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
