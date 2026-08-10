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

    it('names the task, not ownership: "Points to cover" (before/during), "What you covered" (after)', () => {
        const { rerender } = render(<FocusPointsRail rows={rows} topic="T" sessionState="before" />);
        expect(screen.getByText('Points to cover')).toBeInTheDocument();
        expect(screen.queryByText('Your points')).not.toBeInTheDocument();
        rerender(<FocusPointsRail rows={rows} topic="T" sessionState="during" nextIndex={0} />);
        expect(screen.getByText('Points to cover')).toBeInTheDocument();
        rerender(<FocusPointsRail rows={rows} topic="T" sessionState="after" />);
        expect(screen.getByText('What you covered')).toBeInTheDocument();
    });

    it('omits the topic block entirely when no topic is set (blank or null)', () => {
        const { rerender } = render(<FocusPointsRail rows={rows} topic={null} sessionState="before" />);
        expect(screen.queryByTestId('focus-points-topic')).not.toBeInTheDocument();
        rerender(<FocusPointsRail rows={rows} topic="   " sessionState="before" />);
        expect(screen.queryByTestId('focus-points-topic')).not.toBeInTheDocument();
        // The points still render — a missing topic never hides the list.
        expect(screen.getAllByTestId(/^focus-point-\d+$/)).toHaveLength(3);
    });
});
