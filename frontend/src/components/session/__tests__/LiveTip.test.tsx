import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect } from 'vitest';
import { LiveTip } from '../LiveTip';

// #1222 slot D — one tip: imperative headline + evidence sentence + optional green "going right" strip.
describe('LiveTip (#1222 slot D)', () => {
    it('renders the headline, evidence and going-right strip', () => {
        render(<LiveTip tip={{ id: 'um', headline: "Pause instead of 'um'.", evidence: "You've used it 4 times in the last 30 seconds.", goingRight: 'Pace 138 wpm — right in your range.' }} />);
        expect(screen.getByTestId('live-tip-headline')).toHaveTextContent("Pause instead of 'um'.");
        expect(screen.getByTestId('live-tip-evidence')).toHaveTextContent(/4 times in the last 30 seconds/);
        expect(screen.getByTestId('live-tip-going-right')).toHaveTextContent(/Pace 138 wpm/);
        expect(screen.getByTestId('live-tip')).toHaveAttribute('data-tip-id', 'um');
    });

    it('omits the going-right strip when there is nothing going right yet', () => {
        render(<LiveTip tip={{ id: 't', headline: 'Slow down.', evidence: 'Your pace jumped to 190 wpm.' }} />);
        expect(screen.queryByTestId('live-tip-going-right')).toBeNull();
    });
});
