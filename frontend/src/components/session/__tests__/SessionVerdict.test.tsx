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

    /**
     * #1422 casualty E — a successful 1+1 review must never coexist with "Session review not requested."
     *
     * The card used to render a manufactured verdict whenever no legacy coaching prose was supplied,
     * and since that prose is retired (#1306) the fallback was ALWAYS what showed — directly above the
     * real generated review. The screen contradicted itself.
     */
    it('CASUALTY: renders no verdict prose when there is none, and never the retired fallback copy', () => {
        render(
            <SessionVerdict
                verdictLine={null}
                fix={null}
                onPracticeAgain={vi.fn()}
                onSeeAllSessions={vi.fn()}
            />,
        );

        expect(screen.queryByTestId('verdict-line'), 'no fabricated verdict line').toBeNull();
        expect(screen.queryByTestId('verdict-fix'), 'no fabricated fix box').toBeNull();
        expect(screen.queryByText(/Session review not requested/i)).toBeNull();
        expect(screen.queryByText(/Fix this next time/i)).toBeNull();

        // The ACTIONS are not coaching and must survive: this is the only desktop control that starts
        // the next take.
        expect(screen.getByTestId('verdict-practice-again')).toBeInTheDocument();
        expect(screen.getByTestId('verdict-see-all')).toBeInTheDocument();
    });

    it('still renders a verdict line and fix when one is genuinely supplied', () => {
        // The positive control: making the prose optional must not make it unrenderable.
        render(
            <SessionVerdict
                verdictLine="Your cleanest session yet."
                fix="Pause instead of “um”."
                onPracticeAgain={vi.fn()}
                onSeeAllSessions={vi.fn()}
            />,
        );
        expect(screen.getByTestId('verdict-line')).toHaveTextContent('Your cleanest session yet.');
        expect(screen.getByTestId('verdict-fix')).toHaveTextContent(/Pause instead of/);
    });
});
