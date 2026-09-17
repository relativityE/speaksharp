import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect } from 'vitest';
import { SessionShell, type SessionState } from '../SessionShell';

/**
 * Design Correction Brief G1 / S-1 / S-2 — the shared slot map.
 *
 *   A full width · B full width on ink · then a row of C (flex 1) and D (310px).
 *
 * jsdom has no layout, so geometry at 1024/1280/1440 is proven by the Playwright slot-geometry journey. What
 * these lock is the structure that geometry depends on: A and B are NOT inside the two-column row, the row
 * is the only place a split can happen, slot B carries the ink ground itself, and no state reorders slots.
 */
const STATES: SessionState[] = ['before', 'during', 'after'];

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

const orderOf = () => screen.getAllByTestId(/^session-slot-/).map((el) => el.getAttribute('data-slot'));

describe('SessionShell — one slot map for both products (G1)', () => {
    it('renders all four slots with stable landmarks and reflects the state', () => {
        renderState('before');
        expect(screen.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'before');
        expect(screen.getByRole('region', { name: 'Recorder' })).toHaveAttribute('data-slot', 'A');
        expect(screen.getByRole('region', { name: 'Coaching' })).toHaveAttribute('data-slot', 'B');
        expect(screen.getByRole('region', { name: 'Transcript' })).toHaveAttribute('data-slot', 'C');
        expect(screen.getByRole('region', { name: 'This run' })).toHaveAttribute('data-slot', 'D');
    });

    it.each(STATES)('CASUALTY: slots never reorder — %s keeps A, B, C, D', (state) => {
        // The previous shell swapped columns in `after` (A, D, C, B) because it had no full-width slot for the
        // review. A page that reorganises itself at the moment the user looks for their result is the bug.
        renderState(state);
        expect(orderOf()).toEqual(['A', 'B', 'C', 'D']);
    });

    it.each(STATES)('CASUALTY: in %s, A and B sit above the two-column row, never inside it', (state) => {
        // S-1: if the split starts at the top, there is no full-width place for the review to land in `after`.
        renderState(state);
        const shell = screen.getByTestId('session-shell');
        const row = screen.getByTestId('session-shell-row');
        expect(screen.getByTestId('session-slot-a').parentElement).toBe(shell);
        expect(screen.getByTestId('session-slot-b').parentElement).toBe(shell);
        expect(screen.getByTestId('session-slot-c').parentElement).toBe(row);
        expect(screen.getByTestId('session-slot-d').parentElement).toBe(row);
        expect(screen.getByTestId('session-slot-a')).toHaveClass('w-full');
        expect(screen.getByTestId('session-slot-b')).toHaveClass('w-full');
    });

    it.each(STATES)('CASUALTY: slot B carries the flat ink ground in %s — no content can make it white', (state) => {
        // S-2: ink from first paint, in every state. Owned by the shell, so it cannot depend on content.
        renderState(state);
        const b = screen.getByTestId('session-slot-b');
        expect(b).toHaveClass('bg-ink');
        // G2: flat fills only — no gradient, opacity or overlay on a ground.
        expect(b.className).not.toMatch(/gradient|opacity|bg-opacity|\/\d{2}\b/);
    });

    it('lays the row out as flex 1 + a 310px rail from md, stacked below it', () => {
        renderState('before');
        const row = screen.getByTestId('session-shell-row');
        expect(row).toHaveClass('flex', 'flex-col', 'md:flex-row', 'md:items-start');
        expect(screen.getByTestId('session-slot-c')).toHaveClass('min-w-0', 'md:flex-1');
        expect(screen.getByTestId('session-slot-d')).toHaveClass('md:w-[310px]', 'md:shrink-0');
    });

    it('only slot B is dark — A, C and D carry no ground of their own', () => {
        // G11: one dark surface per screen.
        renderState('after');
        for (const slot of ['a', 'c', 'd']) {
            expect(screen.getByTestId(`session-slot-${slot}`).className).not.toMatch(/\bbg-ink\b/);
        }
    });
});
