import { describe, expect, it } from 'vitest';
import { render, screen } from '../../../../tests/support/test-utils';
import { FillerWordsCard } from '../FillerWordsCard';

/**
 * #1047 — the pre-session filler band.
 *
 * Before anyone speaks this was the largest, densest block on the page and it carried NO information:
 * thirteen chips all reading `0`, plus two contradictory empty-state messages. These tests pin the
 * collapse (one line, one message), the expansion once counts exist, and the fact that the tracked
 * count is derived from the real tracked-word list rather than hard-coded.
 */
const zeroData = (words: string[]) =>
    Object.fromEntries([...words.map((w) => [w, { count: 0 }]), ['total', { count: 0 }]]);

const THIRTEEN = [
    'um', 'uh', 'ah', 'like', 'you know', 'so', 'oh',
    'i mean', 'kind of', 'sort of', 'actually', 'basically', 'literally',
];

describe('FillerWordsCard — #1047 pre-session collapse', () => {
    it('collapses to ONE row before any counts exist', () => {
        render(<FillerWordsCard fillerCount={0} fillerData={zeroData(THIRTEEN)} />);

        expect(screen.getByTestId('filler-words-card')).toHaveAttribute('data-filler-collapsed', 'true');
        expect(screen.queryByTestId('filler-words-list')).toBeNull();
        expect(screen.queryByTestId('filler-row-um')).toBeNull();
    });

    it('shows EXACTLY ONE empty message — neither of the two contradictory ones', () => {
        render(
            <FillerWordsCard
                fillerCount={0}
                fillerData={zeroData(THIRTEEN)}
                // The old second message. It must not render even when supplied.
                fillerExplanation="No transcript was captured, so filler words cannot be verified yet."
            />
        );

        expect(screen.getAllByTestId('filler-tracking-summary')).toHaveLength(1);
        expect(screen.queryByText(/No filler words detected yet/i)).toBeNull();
        expect(screen.queryByText(/cannot be verified yet/i)).toBeNull();
        expect(screen.queryByTestId('filler-explanation')).toBeNull();
    });

    it('derives the tracked count from the real word list, never a hard-coded 13', () => {
        const { unmount } = render(<FillerWordsCard fillerCount={0} fillerData={zeroData(THIRTEEN)} />);
        expect(screen.getByTestId('filler-tracking-summary'))
            .toHaveTextContent('Tracking 13 filler words — counts appear here once you speak.');
        unmount();

        // A custom word joins the tracked list; the sentence must follow it.
        render(<FillerWordsCard fillerCount={0} fillerData={zeroData([...THIRTEEN, 'honestly'])} />);
        expect(screen.getByTestId('filler-tracking-summary')).toHaveTextContent('Tracking 14 filler words');
    });

    it('expands to the chip grid as soon as counts exist', () => {
        render(
            <FillerWordsCard
                fillerCount={3}
                fillerData={{ ...zeroData(THIRTEEN), um: { count: 3 } }}
            />
        );

        expect(screen.getByTestId('filler-words-card')).toHaveAttribute('data-filler-collapsed', 'false');
        expect(screen.getByTestId('filler-words-list')).toBeInTheDocument();
        expect(screen.getByTestId('filler-row-um')).toHaveAttribute('data-filler-count', '3');
        expect(screen.queryByTestId('filler-tracking-summary')).toBeNull();
    });

    it('expands on a non-zero word even when the rollup count has not caught up', () => {
        render(<FillerWordsCard fillerCount={0} fillerData={{ ...zeroData(THIRTEEN), like: { count: 2 } }} />);
        expect(screen.getByTestId('filler-words-list')).toBeInTheDocument();
    });

    it('keeps the "Add your filler words" action reachable on the collapsed row', () => {
        render(
            <FillerWordsCard
                fillerCount={0}
                fillerData={zeroData(THIRTEEN)}
                headerAction={<button type="button">Add your filler words</button>}
            />
        );
        expect(screen.getByRole('button', { name: 'Add your filler words' })).toBeInTheDocument();
    });
});
