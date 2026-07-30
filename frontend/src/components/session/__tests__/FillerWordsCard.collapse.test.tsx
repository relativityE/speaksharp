import { describe, expect, it } from 'vitest';
import { render, screen } from '../../../../tests/support/test-utils';
import { FillerWordsCard } from '../FillerWordsCard';
import { FILLER_TRANSCRIPT_DISCLOSURE } from '@/utils/sessionAnalysis';

/**
 * #1047 — the filler evidence band's SIX states.
 *
 * The point of these tests is truthfulness, not layout. Every message this card can show has to be
 * true at the moment it shows it, and the three failure modes this suite guards are all cases where a
 * collapsed state told a lie:
 *   - claiming counts "appear as you speak" to someone who already finished speaking;
 *   - asserting a result (even a zero) while the decode is still running;
 *   - using the same copy for "none detected" and "could not verify".
 */
const zeroData = (words: string[]) =>
    Object.fromEntries([...words.map((w) => [w, { count: 0 }]), ['total', { count: 0 }]]);

const THIRTEEN = [
    'um', 'uh', 'ah', 'like', 'you know', 'so', 'oh',
    'i mean', 'kind of', 'sort of', 'actually', 'basically', 'literally',
];

const base = {
    fillerCount: 0,
    fillerData: zeroData(THIRTEEN),
};

describe('FillerWordsCard — #1047 six states', () => {
    // The card must remain addressable by assistive tech (and by tests) in every state, including the
    // ones where the visual heading collapses away.
    it.each([
        ['before-recording', {}],
        ['listening', { isListening: true }],
        ['finalizing', { isFinalizing: true }],
        ['zero-detected', { hasSpoken: true, wordCount: 40 }],
        ['insufficient-transcript', { hasSpoken: true, wordCount: 0 }],
        ['counts', { fillerCount: 2, fillerData: { ...zeroData(THIRTEEN), um: { count: 2 } } }],
    ])('keeps a stable accessible name and the action in the %s state', (name, props) => {
        render(
            <FillerWordsCard
                {...base}
                {...props}
                headerAction={<button type="button">Add your filler words</button>}
            />
        );

        expect(screen.getByRole('region', { name: 'Detected filler words' }))
            .toHaveAttribute('data-filler-state', name);
        // The action is retained in every state — it is how a user reaches their custom words.
        expect(screen.getByRole('button', { name: 'Add your filler words' })).toBeInTheDocument();
    });

    describe('1. before recording', () => {
        it('states what is tracked and when counts arrive', () => {
            render(<FillerWordsCard {...base} />);

            expect(screen.getByTestId('filler-tracking-summary')).toHaveTextContent('Tracking 13 filler words');
            expect(screen.getByTestId('filler-support-text')).toHaveTextContent('Counts appear here as you speak.');
            expect(screen.queryByTestId('filler-words-list')).toBeNull();
            expect(screen.queryByTestId('filler-row-um')).toBeNull();
        });

        it('derives the tracked count from the real word list, never a hard-coded 13', () => {
            const { unmount } = render(<FillerWordsCard {...base} />);
            expect(screen.getByTestId('filler-tracking-summary')).toHaveTextContent('Tracking 13 filler words');
            unmount();

            render(<FillerWordsCard fillerCount={0} fillerData={zeroData([...THIRTEEN, 'honestly'])} />);
            expect(screen.getByTestId('filler-tracking-summary')).toHaveTextContent('Tracking 14 filler words');
        });

        it('shows neither of the two old contradictory empty messages', () => {
            render(
                <FillerWordsCard
                    {...base}
                    fillerExplanation="No transcript was captured, so filler words cannot be verified yet."
                />
            );

            expect(screen.queryByText(/No filler words detected yet/i)).toBeNull();
            expect(screen.queryByText(/cannot be verified yet/i)).toBeNull();
        });
    });

    describe('2. recording, nothing detected yet', () => {
        it('says it is listening and shows NO zero chips', () => {
            render(<FillerWordsCard {...base} isListening />);

            expect(screen.getByTestId('filler-listening-summary'))
                .toHaveTextContent('Listening for 13 filler words');
            expect(screen.queryByTestId('filler-words-list')).toBeNull();
            expect(screen.queryByTestId('filler-badge-count')).toBeNull();
        });

        it('does not claim a result — not even a zero', () => {
            render(<FillerWordsCard {...base} isListening />);

            expect(screen.queryByText(/No detected filler words/i)).toBeNull();
            expect(screen.queryByText(/once you speak/i)).toBeNull();
        });
    });

    describe('3. finalizing', () => {
        it('claims no count while the decode is still running', () => {
            render(<FillerWordsCard {...base} isFinalizing hasSpoken wordCount={40} />);

            expect(screen.getByTestId('filler-finalizing-summary'))
                .toHaveTextContent('Checking your transcript for filler words');
            expect(screen.queryByText(/No detected filler words/i)).toBeNull();
            expect(screen.queryByTestId('filler-words-list')).toBeNull();
        });

        it('outranks a partial live count, which is still moving mid-decode', () => {
            render(
                <FillerWordsCard
                    fillerCount={2}
                    fillerData={{ ...zeroData(THIRTEEN), um: { count: 2 } }}
                    isFinalizing
                    hasSpoken
                    wordCount={40}
                />
            );

            expect(screen.getByTestId('filler-words-card')).toHaveAttribute('data-filler-state', 'finalizing');
            expect(screen.queryByTestId('filler-words-list')).toBeNull();
        });
    });

    // The #894 regression guard. An earlier revision reused the pre-session copy for every zero and
    // suppressed `fillerExplanation` entirely — hiding the disclosure in the one state where an
    // unqualified `0` is most likely to be over-trusted.
    describe('4. completed, valid transcript, zero detected', () => {
        it('states the zero as a result and never "as you speak"', () => {
            render(<FillerWordsCard {...base} hasSpoken wordCount={40} />);

            expect(screen.getByTestId('filler-measured-zero'))
                .toHaveTextContent('No detected filler words in this transcript.');
            expect(screen.queryByText(/as you speak/i)).toBeNull();
            expect(screen.queryByTestId('filler-tracking-summary')).toBeNull();
        });

        it('carries the #894 disclosure with the zero it qualifies', () => {
            render(<FillerWordsCard {...base} hasSpoken wordCount={40} />);

            expect(screen.getByTestId('filler-explanation'))
                .toHaveTextContent(FILLER_TRANSCRIPT_DISCLOSURE);
            expect(FILLER_TRANSCRIPT_DISCLOSURE)
                .toBe('Some spoken fillers may not appear in the transcript.');
        });

        it('keeps the grid collapsed', () => {
            render(<FillerWordsCard {...base} hasSpoken wordCount={40} />);

            expect(screen.getByTestId('filler-words-card')).toHaveAttribute('data-filler-collapsed', 'true');
            expect(screen.queryByTestId('filler-words-list')).toBeNull();
        });

        it('states the result exactly once — the zero is not repeated by the explanation', () => {
            render(
                <FillerWordsCard
                    {...base}
                    hasSpoken
                    wordCount={40}
                    // The full explanation opens with its own "No filler words were detected"; only the
                    // disclosure is used here so the card does not say the result twice.
                    fillerExplanation={`No filler words were detected. Keep using silence as your reset instead of filling the space. ${FILLER_TRANSCRIPT_DISCLOSURE}`}
                />
            );

            expect(screen.queryByText(/No filler words were detected/i)).toBeNull();
            expect(screen.getAllByText(FILLER_TRANSCRIPT_DISCLOSURE)).toHaveLength(1);
        });
    });

    describe('5. completed, fillers detected', () => {
        const withCounts = {
            fillerCount: 5,
            fillerData: { ...zeroData(THIRTEEN), um: { count: 3 }, like: { count: 2 } },
        };

        it('expands the grid', () => {
            render(<FillerWordsCard {...withCounts} hasSpoken wordCount={40} />);

            expect(screen.getByTestId('filler-words-card')).toHaveAttribute('data-filler-collapsed', 'false');
            expect(screen.getByTestId('filler-words-list')).toBeInTheDocument();
            expect(screen.getByTestId('filler-row-um')).toHaveAttribute('data-filler-count', '3');
        });

        it('shows ONLY useful counts, never the tracked words sitting at zero', () => {
            render(<FillerWordsCard {...withCounts} hasSpoken wordCount={40} />);

            expect(screen.getAllByTestId('filler-badge-count')).toHaveLength(2);
            expect(screen.queryByTestId('filler-row-basically')).toBeNull();
            expect(screen.queryByTestId('filler-row-literally')).toBeNull();
        });

        it('shows the disclosure exactly once', () => {
            render(
                <FillerWordsCard
                    {...withCounts}
                    hasSpoken
                    wordCount={40}
                    fillerExplanation={`5 filler words detected, about 12.5% of captured words. Light usage; watch for repeats during transitions. ${FILLER_TRANSCRIPT_DISCLOSURE}`}
                />
            );

            expect(screen.getAllByText(new RegExp(FILLER_TRANSCRIPT_DISCLOSURE, 'i'))).toHaveLength(1);
        });

        it('expands during recording too — real evidence is shown as soon as it exists', () => {
            render(<FillerWordsCard {...withCounts} isListening />);

            expect(screen.getByTestId('filler-words-list')).toBeInTheDocument();
            expect(screen.queryByTestId('filler-listening-summary')).toBeNull();
        });
    });

    describe('6. transcript missing or insufficient', () => {
        it.each([0, 1, 2])('does NOT report zero at wordCount %i', (wordCount) => {
            render(<FillerWordsCard {...base} hasSpoken wordCount={wordCount} />);

            expect(screen.getByTestId('filler-unverified'))
                .toHaveTextContent('Not enough transcript to verify filler words.');
            // "None detected" and "could not verify" are DIFFERENT claims.
            expect(screen.queryByTestId('filler-measured-zero')).toBeNull();
            expect(screen.queryByText(/No detected filler words/i)).toBeNull();
        });

        it('is a distinct state from a verified zero', () => {
            const { unmount } = render(<FillerWordsCard {...base} hasSpoken wordCount={0} />);
            expect(screen.getByTestId('filler-words-card'))
                .toHaveAttribute('data-filler-state', 'insufficient-transcript');
            unmount();

            render(<FillerWordsCard {...base} hasSpoken wordCount={40} />);
            expect(screen.getByTestId('filler-words-card'))
                .toHaveAttribute('data-filler-state', 'zero-detected');
        });
    });
});
