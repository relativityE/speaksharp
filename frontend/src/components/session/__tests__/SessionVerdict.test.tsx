import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { SessionVerdict } from '../SessionVerdict';

// #1222 slot D (after) — exactly: one verdict line, one FIX THIS NEXT TIME box, two actions.
describe('SessionVerdict (#1222 slot D after)', () => {
    const base = {
        verdictLine: 'Your cleanest session yet.',
        fix: "You opened three sentences with 'um' — 4 of your 5 fillers sat at a sentence start.",
        onPracticeAgain: vi.fn(),
        onSeeAllSessions: vi.fn(),
    };

    it('renders the one verdict line, the fix box, and the two actions', () => {
        render(<SessionVerdict {...base} />);
        expect(screen.getByTestId('verdict-line')).toHaveTextContent('Your cleanest session yet.');
        expect(screen.getByTestId('verdict-fix')).toHaveTextContent(/Fix this next time/i);
        expect(screen.getByTestId('verdict-fix')).toHaveTextContent(/4 of your 5 fillers/);
        expect(screen.getByTestId('verdict-practice-again')).toBeInTheDocument();
        expect(screen.getByTestId('verdict-see-all')).toBeInTheDocument();
    });

    it('never shows a score/100 or confetti', () => {
        render(<SessionVerdict {...base} />);
        expect(screen.queryByText(/\/\s*100/)).toBeNull();
    });

    it('wires the two actions', () => {
        const onPracticeAgain = vi.fn();
        const onSeeAllSessions = vi.fn();
        render(<SessionVerdict {...base} onPracticeAgain={onPracticeAgain} onSeeAllSessions={onSeeAllSessions} />);
        fireEvent.click(screen.getByTestId('verdict-practice-again'));
        fireEvent.click(screen.getByTestId('verdict-see-all'));
        expect(onPracticeAgain).toHaveBeenCalledOnce();
        expect(onSeeAllSessions).toHaveBeenCalledOnce();
    });
});
