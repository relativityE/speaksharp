import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect } from 'vitest';
import { FocusPointsRail } from '../FocusPointsRail';
import type { FocusCoverageRow } from '@/utils/focusCoverage';

const rows: FocusCoverageRow[] = [
    { label: 'a', status: 'missing', covered: false, coveredAtSec: null, quote: null },
    { label: 'b', status: 'missing', covered: false, coveredAtSec: null, quote: null },
    { label: 'c', status: 'missing', covered: false, coveredAtSec: null, quote: null },
];

// #1046 G6/G7 — the topic is a header above the points (never a point), and the card is "Points to cover".
describe('FocusPointsRail — topic line + rename (#1046 G6/G7)', () => {
    it('renders the topic above the points, unnumbered, with a YOUR TOPIC caption', () => {
        render(<FocusPointsRail rows={rows} topic="Micro-Decisions" sessionState="before" />);
        const topic = screen.getByTestId('focus-points-topic');
        expect(topic).toHaveTextContent('Micro-Decisions');
        expect(topic).toHaveTextContent(/your topic/i);
        // The topic is NOT one of the numbered points — the list still has exactly the 3 real points.
        expect(screen.getAllByTestId(/^focus-point-\d+$/)).toHaveLength(3);
        expect(screen.getByText('a')).toBeInTheDocument();
        expect(screen.getByText('c')).toBeInTheDocument();
    });

    // #1254: the after-state title is now "What we detected". The old wording asserted what the SPEAKER
    // covered; the engine is a conservative keyword matcher and can only report what it detected.
    it('names the task, not ownership: "Points to cover" (before/during), "What we detected" (after)', () => {
        const { rerender } = render(<FocusPointsRail rows={rows} topic="T" sessionState="before" />);
        expect(screen.getByText('Points to cover')).toBeInTheDocument();
        expect(screen.queryByText('Your points')).not.toBeInTheDocument();
        rerender(<FocusPointsRail rows={rows} topic="T" sessionState="during" nextIndex={0} />);
        expect(screen.getByText('Points to cover')).toBeInTheDocument();
        rerender(<FocusPointsRail rows={rows} topic="T" sessionState="after" />);
        expect(screen.getByText('What we detected')).toBeInTheDocument();
    });

    it('after: a missed point states the real cause (last-covered timestamp) then the forward move — no fabricated waste', () => {
        const afterRows: FocusCoverageRow[] = [
            { label: 'What is it?', status: 'covered', covered: true, coveredAtSec: 21, quote: 'the small calls' },
            { label: 'Effects', status: 'covered', covered: true, coveredAtSec: 64, quote: 'ten boring ones' },
            { label: 'One habit', status: 'missing', covered: false, coveredAtSec: null, quote: null },
        ];
        render(<FocusPointsRail rows={afterRows} topic="Micro-Decisions" sessionState="after" />);
        const missed = screen.getByTestId('focus-point-2-not-detected');
        expect(missed).toHaveTextContent('We couldn’t detect this point in the transcript. You may have covered it in different words.');
        // Honest: no "waste"/"behind"/"seconds off-point" phrasing.
        for (const b of ['wasted', 'behind', 'off-point', 'seconds off']) expect(missed.textContent!.toLowerCase()).not.toContain(b);
    });

    it('omits the topic block entirely when no topic is set (blank or null)', () => {
        const { rerender } = render(<FocusPointsRail rows={rows} topic={null} sessionState="before" />);
        expect(screen.queryByTestId('focus-points-topic')).not.toBeInTheDocument();
        rerender(<FocusPointsRail rows={rows} topic="   " sessionState="before" />);
        expect(screen.queryByTestId('focus-points-topic')).not.toBeInTheDocument();
        // The points still render — a missing topic never hides the list.
        expect(screen.getAllByTestId(/^focus-point-\d+$/)).toHaveLength(3);
    });

    it('offers an honest retry without claiming every point was undetected', () => {
        const mixed: FocusCoverageRow[] = [
            { label: 'Detected', status: 'covered', covered: true, coveredAtSec: 10, quote: null },
            { label: 'Not detected', status: 'missing', covered: false, coveredAtSec: null, quote: null },
        ];
        render(<FocusPointsRail rows={mixed} sessionState="after" onRetry={() => {}} />);
        expect(screen.getByTestId('focus-points-retry')).toHaveTextContent('Retry this set');
        expect(screen.getByTestId('focus-points-retry')).not.toHaveTextContent('2 points');
    });
});
