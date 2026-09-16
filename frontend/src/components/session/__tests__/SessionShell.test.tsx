import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect } from 'vitest';
import { SessionShell, type SessionState } from '../SessionShell';

// #1222 §1 as amended for #1474 (G10): a slot keeps STABLE LANDMARK IDENTITY in every state and slots never
// reorder WITHIN a state. The original rule forbade any movement between states; G10 supersedes that for the
// `after` state only, where the Practice Loop review must be the dominant result and its acceptance requires
// coaching to precede the transcript and secondary metrics in keyboard and screen-reader order.
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

    it('keeps every slot present with stable identity in all three states, and reorders only for after', () => {
        const { rerender } = renderState('before');
        const orderFor = () => screen.getAllByTestId(/^session-slot-/).map((el) => el.getAttribute('data-slot'));
        const identity = () => screen.getAllByTestId(/^session-slot-/)
            .map((el) => `${el.getAttribute('data-slot')}:${el.getAttribute('aria-label')}`)
            .sort();
        const LANDMARKS = ['A:Recorder', 'B:Transcript', 'C:Progress', 'D:Coaching'];

        expect(orderFor()).toEqual(['A', 'B', 'C', 'D']);
        expect(identity()).toEqual(LANDMARKS);

        rerender(
            <SessionShell sessionState="during"
                slotA={<div>a</div>} slotB={<div>b</div>} slotC={<div>c</div>} slotD={<div>d</div>} />,
        );
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'during');
        expect(orderFor()).toEqual(['A', 'B', 'C', 'D']);
        expect(identity()).toEqual(LANDMARKS);

        rerender(
            <SessionShell sessionState="after"
                slotA={<div>a</div>} slotB={<div>b</div>} slotC={<div>c</div>} slotD={<div>d</div>} />,
        );
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'after');
        // #1474 G10: the review takes the wide primary column and precedes metrics and transcript.
        expect(orderFor()).toEqual(['A', 'D', 'C', 'B']);
        // Identity is unchanged — the same four landmarks, none renamed, none dropped. That is the amended rule.
        expect(identity()).toEqual(LANDMARKS);
    });

    it('#1474 G10: in after, coaching precedes BOTH secondary metrics and the transcript in DOM order', () => {
        renderState('after');
        const order = screen.getAllByTestId(/^session-slot-/).map((el) => el.getAttribute('data-slot'));
        // DOM order drives keyboard order and screen-reader traversal, which is what G10's acceptance names.
        expect(order.indexOf('D')).toBeLessThan(order.indexOf('C'));
        expect(order.indexOf('D')).toBeLessThan(order.indexOf('B'));
    });

    it('#1474 G10: in after, coaching fills the primary column and the transcript fills the rail', () => {
        renderState('after');
        expect(screen.getByTestId('session-slot-d')).toHaveStyle({ flex: '1 1 auto' });
        expect(screen.getByTestId('session-slot-b')).toHaveStyle({ flex: '1 1 auto' });
        expect(screen.getByTestId('session-slot-a')).toHaveStyle({ flex: '0 0 auto' });
        expect(screen.getByTestId('session-slot-c')).toHaveStyle({ flex: '0 0 auto' });
    });

    // #1255 — the responsive contract: ONE stacked column on phones, the 1.55fr/1fr two-column grid from
    // the md breakpoint up. jsdom cannot evaluate the media query, so this locks the class contract that
    // the Playwright journey then proves renders correctly at real phone/desktop widths.
    it('carries the responsive grid classes (stacked on phones, 1.55fr/1fr from md)', () => {
        renderState('before');
        const shell = screen.getByTestId('session-shell');
        expect(shell).toHaveClass('grid');
        expect(shell).toHaveClass('grid-cols-1');
        expect(shell).toHaveClass('md:grid-cols-[1.55fr_1fr]');
    });

    it('each slot carries a stable accessible landmark', () => {
        renderState('before');
        expect(screen.getByRole('region', { name: 'Recorder' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Transcript' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Progress' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Coaching' })).toBeInTheDocument();
    });
});
