import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect } from 'vitest';
import { CoveragePace } from '../CoveragePace';

// #1046 G6/G7 §2 — Coverage & pace: count + pace-per-point + projection + nudge; never a countdown; no pips.
describe('CoveragePace (#1046 §2)', () => {
    it('no guide → the card is the count alone (no pace, no bar, no projection)', () => {
        render(<CoveragePace covered={2} total={3} elapsedSec={150} guideSecPerPoint={null} sessionState="during" />);
        expect(screen.getByTestId('coverage-pace-count')).toHaveTextContent('2/3');
        expect(screen.queryByTestId('coverage-pace-perpoint')).not.toBeInTheDocument();
        expect(screen.queryByTestId('coverage-pace-bar')).not.toBeInTheDocument();
        expect(screen.queryByTestId('coverage-pace-projection')).not.toBeInTheDocument();
    });

    it('guide + zero covered → "— /point", no projection line (never ∞, never elapsed)', () => {
        render(<CoveragePace covered={0} total={3} elapsedSec={40} guideSecPerPoint={60} sessionState="during" />);
        expect(screen.getByTestId('coverage-pace-perpoint')).toHaveTextContent('— /point');
        expect(screen.queryByTestId('coverage-pace-projection')).not.toBeInTheDocument();
        expect(screen.queryByText('0:40')).not.toBeInTheDocument(); // elapsed is never shown
    });

    it('during, over guide → pace-per-point + "at this pace" projection against the guide total', () => {
        render(<CoveragePace covered={2} total={3} elapsedSec={150} guideSecPerPoint={60} sessionState="during" />);
        expect(screen.getByTestId('coverage-pace-perpoint')).toHaveTextContent('1:15 /point');
        const proj = screen.getByTestId('coverage-pace-projection');
        expect(proj).toHaveTextContent('3:00 guide');
        expect(proj).toHaveTextContent('3:45 at this pace');
        // Never a countdown / remaining time.
        expect(proj).not.toHaveTextContent(/left|remaining/i);
    });

    it('after → the projection reads "actual", the bar is frozen, and no nudge renders', () => {
        render(<CoveragePace covered={2} total={3} elapsedSec={204} guideSecPerPoint={60} sessionState="after" nudge="should not show" />);
        expect(screen.getByTestId('coverage-pace-projection')).toHaveTextContent('3:24 actual');
        expect(screen.queryByTestId('coverage-pace-nudge')).not.toBeInTheDocument();
    });

    it('renders the nudge inside the card during only, when supplied', () => {
        render(<CoveragePace covered={2} total={3} elapsedSec={150} guideSecPerPoint={60} sessionState="during" nudge="Point 3 whenever you're ready." />);
        expect(screen.getByTestId('coverage-pace-nudge')).toHaveTextContent("Point 3 whenever you're ready.");
    });

    it('never renders pips', () => {
        render(<CoveragePace covered={2} total={3} elapsedSec={150} guideSecPerPoint={60} sessionState="during" />);
        expect(screen.queryByTestId('coverage-this-run-pips')).not.toBeInTheDocument();
    });
});
