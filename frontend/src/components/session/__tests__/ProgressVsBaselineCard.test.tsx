import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect } from 'vitest';
import { ProgressVsBaselineCard } from '../ProgressVsBaselineCard';

// G16 D1 — slot D in `before` is a white card that always has a body; a heading alone is not a state.
describe('ProgressVsBaselineCard (G16 D1)', () => {
    it('CASUALTY: with no comparable number it still renders a surface and a body — never a bare heading', () => {
        render(<ProgressVsBaselineCard progress={null} isFirstSession />);
        const card = screen.getByTestId('progress-vs-baseline');
        expect(card.className).toContain('bg-neutral-page');
        expect(card).toHaveAttribute('data-progress-body', 'no-history');
        expect(screen.getByTestId('progress-vs-baseline-line')).toHaveTextContent('First session — this run becomes your baseline.');
        expect(card).toHaveTextContent('Comparisons start once you have two runs of a similar length.');
        expect(card.textContent ?? '').not.toMatch(/See your progress/);
    });

    it('CASUALTY: a returning user without a number is never told it is their first session', () => {
        render(<ProgressVsBaselineCard progress={null} isFirstSession={false} />);
        expect(screen.getByTestId('progress-vs-baseline-line').textContent).not.toMatch(/first session/i);
    });

    it('numeric body: value, unit and window; improvement in the status green, regression in amber', () => {
        const { rerender } = render(
            <ProgressVsBaselineCard progress={{ value: '−24%', unit: 'fillers', direction: 'improvement', windowLabel: 'Against your 6 Jul baseline, last 5 runs.' }} isFirstSession={false} />,
        );
        expect(screen.getByTestId('progress-vs-baseline')).toHaveAttribute('data-progress-body', 'numeric');
        expect(screen.getByTestId('progress-vs-baseline-value')).toHaveTextContent('−24%');
        expect(screen.getByTestId('progress-vs-baseline-value').className).toContain('text-status');
        rerender(<ProgressVsBaselineCard progress={{ value: '+8%', unit: 'fillers', direction: 'regression', windowLabel: 'w' }} isFirstSession={false} />);
        expect(screen.getByTestId('progress-vs-baseline-value').className).toContain('text-signature-text');
    });
});
