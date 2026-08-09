import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect } from 'vitest';
import { SessionShell, type SessionState } from '../SessionShell';

// #1222 §1 — the governing rule: the four slots never move/reorder/remount across states; only content changes.
describe('SessionShell (#1222 §1 — fixed slots)', () => {
    const renderState = (sessionState: SessionState) =>
        render(
            <SessionShell
                sessionState={sessionState}
                slotA={<div data-testid="content-a">A:{sessionState}</div>}
                slotB={<div data-testid="content-b">B:{sessionState}</div>}
                slotC={<div data-testid="content-c">C:{sessionState}</div>}
                slotD={<div data-testid="content-d">D:{sessionState}</div>}
            />,
        );

    it('renders all four slots and reflects the session state', () => {
        renderState('before');
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'before');
        for (const slot of ['a', 'b', 'c', 'd']) {
            expect(screen.getByTestId(`session-slot-${slot}`)).toBeInTheDocument();
        }
    });

    it('keeps slot order A,B (left) then C,D (rail) in the DOM', () => {
        renderState('before');
        const slots = screen.getAllByTestId(/^session-slot-/).map((el) => el.getAttribute('data-slot'));
        expect(slots).toEqual(['A', 'B', 'C', 'D']);
    });

    it('slot wrappers hold identical identity + order across before/during/after (only content changes)', () => {
        const { rerender } = renderState('before');
        const orderFor = () => screen.getAllByTestId(/^session-slot-/).map((el) => el.getAttribute('data-slot'));
        expect(orderFor()).toEqual(['A', 'B', 'C', 'D']);

        rerender(
            <SessionShell sessionState="during"
                slotA={<div>a</div>} slotB={<div>b</div>} slotC={<div>c</div>} slotD={<div>d</div>} />,
        );
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'during');
        expect(orderFor()).toEqual(['A', 'B', 'C', 'D']);

        rerender(
            <SessionShell sessionState="after"
                slotA={<div>a</div>} slotB={<div>b</div>} slotC={<div>c</div>} slotD={<div>d</div>} />,
        );
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        expect(orderFor()).toEqual(['A', 'B', 'C', 'D']);
    });

    it('each slot carries a stable accessible landmark', () => {
        renderState('before');
        expect(screen.getByRole('region', { name: 'Recorder' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Transcript' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Progress' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Coaching' })).toBeInTheDocument();
    });
});
