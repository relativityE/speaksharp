import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect } from 'vitest';
import { ClarityVsLastSessionCard } from '../ClarityVsLastSessionCard';
import type { ClarityMove } from '@/hooks/useClarityMove';

const move = (over: Partial<Extract<ClarityMove, { kind: 'move' }>> = {}): ClarityMove => ({
    kind: 'move',
    previousPercent: 82,
    currentPercent: 88,
    direction: 'improved',
    referenceDateLabel: '14 Sep',
    ...over,
});

// G18 — slot D in `before` states THE MOVE in the unit the app already speaks, and always has a body.
describe('ClarityVsLastSessionCard (G18)', () => {
    it('CASUALTY: with no comparable number it still renders a surface and a body — never a bare heading', () => {
        render(<ClarityVsLastSessionCard move={{ kind: 'first-session' }} />);
        const card = screen.getByTestId('clarity-vs-last-session');
        expect(card.className).toContain('bg-neutral-page');
        expect(card).toHaveAttribute('data-progress-body', 'no-history');
        expect(screen.getByTestId('clarity-vs-last-session-line')).toHaveTextContent('First session — this run becomes your baseline.');
        expect(card).toHaveTextContent('Comparisons start after your next full session.');
        expect(card.textContent ?? '').not.toMatch(/See your progress/);
    });

    it('CASUALTY: a returning user without a number is never told it is their first session', () => {
        render(<ClarityVsLastSessionCard move={{ kind: 'no-comparison' }} />);
        expect(screen.getByTestId('clarity-vs-last-session-line')).toHaveTextContent(/^No comparable run yet\.$/);
    });

    it('the eyebrow names the OUTCOME, and clarity is demoted to the detail line rather than renamed', () => {
        render(<ClarityVsLastSessionCard move={move()} />);
        const card = screen.getByTestId('clarity-vs-last-session');
        expect(card).toHaveAccessibleName('Your progress');
        expect(card).toHaveTextContent('Your progress');
        expect(card).toHaveTextContent('Fillers, errors, pace');
        expect(card.textContent ?? '').not.toMatch(/clarity/i);
    });

    it('improved: both percents and a direction; only the SECOND number takes the outcome colour', () => {
        render(<ClarityVsLastSessionCard move={move()} />);
        expect(screen.getByTestId('clarity-vs-last-session')).toHaveAttribute('data-progress-body', 'numeric');
        expect(screen.getByTestId('clarity-vs-last-session-value')).toHaveTextContent(/82%\s*→\s*88%/);
        expect(screen.getByTestId('clarity-vs-last-session-current').className).toContain('text-status');
        expect(screen.getByTestId('clarity-vs-last-session-support')).toHaveTextContent('Clearer than your 14 Sep session.');
    });

    it('declined: the second number is the signature amber, and the support line says less clear', () => {
        render(<ClarityVsLastSessionCard move={move({ previousPercent: 88, currentPercent: 83, direction: 'declined' })} />);
        expect(screen.getByTestId('clarity-vs-last-session-value')).toHaveTextContent(/88%\s*→\s*83%/);
        expect(screen.getByTestId('clarity-vs-last-session-current').className).toContain('text-signature-text');
        expect(screen.getByTestId('clarity-vs-last-session-support')).toHaveTextContent('Less clear than your 14 Sep session.');
    });

    /*
     * The branch PM asked to look at hardest: a real one-point move under the 3-point significance threshold.
     * Both numbers are shown so "why wasn't that an improvement" is answerable by looking, and the copy
     * declines to celebrate it — so the number must carry NEITHER outcome colour.
     */
    it('held steady: both numbers are shown, in neutral ink, and the copy does not celebrate the move', () => {
        render(<ClarityVsLastSessionCard move={move({ previousPercent: 88, currentPercent: 89, direction: 'held_steady' })} />);
        const card = screen.getByTestId('clarity-vs-last-session');
        expect(card).toHaveAttribute('data-progress-body', 'numeric');
        expect(card).toHaveAttribute('data-progress-direction', 'held_steady');
        expect(screen.getByTestId('clarity-vs-last-session-value')).toHaveTextContent(/88%\s*→\s*89%/);
        const current = screen.getByTestId('clarity-vs-last-session-current').className;
        expect(current).not.toContain('text-status');
        expect(current).not.toContain('text-signature-text');
        expect(screen.getByTestId('clarity-vs-last-session-support')).toHaveTextContent('Holding steady since 14 Sep.');
    });

    // D1d — the window line names the compared session by DATE and claims no adjacency: eligibility can skip
    // a non-qualifying run, so `last` / `previous` / `comparable` would all overclaim.
    it.each(['improved', 'declined', 'held_steady'] as const)('D1d: the %s window line names the date and no ordinal', (direction) => {
        render(<ClarityVsLastSessionCard move={move({ direction })} />);
        const support = screen.getByTestId('clarity-vs-last-session-support').textContent ?? '';
        expect(support).toContain('14 Sep');
        expect(support).not.toMatch(/\b(last|previous|comparable)\b/i);
    });

    // D1e — slot D carries no colour outside the token set; the withdrawn draft values must not reappear.
    it('D1e: the card uses tokens only — no raw hex anywhere in its markup', () => {
        const { container } = render(<ClarityVsLastSessionCard move={move()} />);
        expect(container.innerHTML).not.toMatch(/#[0-9a-f]{6}/i);
        expect(container.innerHTML).not.toMatch(/2b3446|9aa3b2|eef1f6/i);
    });

    // The delta is deliberately absent: `+6` beside `82% → 88%` is the same fact twice, and a lone `+1` is
    // exactly what made the threshold unanswerable on screen.
    it('CASUALTY: the card never prints a delta or a percent-of-previous', () => {
        render(<ClarityVsLastSessionCard move={move()} />);
        const text = screen.getByTestId('clarity-vs-last-session').textContent ?? '';
        expect(text).not.toMatch(/[+−-]\s?\d/);
        expect(text.match(/%/g) ?? []).toHaveLength(2);
    });
});
