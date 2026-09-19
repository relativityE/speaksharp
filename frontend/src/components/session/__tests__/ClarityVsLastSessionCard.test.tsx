import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect } from 'vitest';
import { ClarityVsLastSessionCard } from '../ClarityVsLastSessionCard';

// G16 D1 — slot D in `before` is a white card that always has a body; a heading alone is not a state.
describe('ClarityVsLastSessionCard (G16 D1)', () => {
    it('CASUALTY: with no comparable number it still renders a surface and a body — never a bare heading', () => {
        render(<ClarityVsLastSessionCard progress={null} isFirstSession />);
        const card = screen.getByTestId('clarity-vs-last-session');
        expect(card.className).toContain('bg-neutral-page');
        expect(card).toHaveAttribute('data-progress-body', 'no-history');
        expect(screen.getByTestId('clarity-vs-last-session-line')).toHaveTextContent('First session — this run becomes your baseline.');
        expect(card).toHaveTextContent('Comparisons start after your next full session.');
        expect(card.textContent ?? '').not.toMatch(/See your progress/);
    });

    it('CASUALTY: a returning user without a number is never told it is their first session', () => {
        render(<ClarityVsLastSessionCard progress={null} isFirstSession={false} />);
        // Designer 2026-09-19: one variable first line — never a first-session claim, never an explanation.
        expect(screen.getByTestId('clarity-vs-last-session-line')).toHaveTextContent(/^No comparable run yet\.$/);
    });

    it('numeric body: value, unit and window; improvement in the status green, regression in amber', () => {
        const { rerender } = render(
            <ClarityVsLastSessionCard progress={{ value: '+6', unit: 'clarity', direction: 'improvement', windowLabel: 'Against your previous session, 14 Sep.', referenceDateLabel: '14 Sep' }} isFirstSession={false} />,
        );
        expect(screen.getByTestId('clarity-vs-last-session')).toHaveAttribute('data-progress-body', 'numeric');
        expect(screen.getByTestId('clarity-vs-last-session-value')).toHaveTextContent('+6');
        expect(screen.getByTestId('clarity-vs-last-session-value').className).toContain('text-status');
        rerender(<ClarityVsLastSessionCard progress={{ value: '−3', unit: 'clarity', direction: 'regression', windowLabel: 'w', referenceDateLabel: '14 Sep' }} isFirstSession={false} />);
        expect(screen.getByTestId('clarity-vs-last-session-value').className).toContain('text-signature-text');
    });
});
