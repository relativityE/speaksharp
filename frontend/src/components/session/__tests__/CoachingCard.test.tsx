import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect } from 'vitest';
import { CoachingCard } from '../CoachingCard';

// Slot B — one component, content changes per state, on the ink ground the shell provides (S-2, S-3, F-1).
describe('CoachingCard (slot B)', () => {
    it('before → a yellow LIVE COACHING eyebrow and four words, nothing about its own mechanics', () => {
        render(<CoachingCard sessionState="before" />);
        expect(screen.getByTestId('coaching-placeholder')).toBeInTheDocument();
        expect(screen.getByTestId('coaching-card')).toHaveAttribute('data-coaching-state', 'before');
        expect(screen.getByTestId('coaching-eyebrow')).toHaveClass('text-signature');
        expect(screen.getByText('Tips appear as you speak.')).toHaveClass('text-ink-muted');
        expect(screen.queryByText(/first tip appears here|20 seconds/i)).toBeNull();
    });

    it('carries no card chrome of its own — the shell owns the ground', () => {
        render(<CoachingCard sessionState="before" />);
        const card = screen.getByTestId('coaching-card');
        expect(card.className).not.toMatch(/\bbg-|\bborder\b|rounded/);
    });

    it('during → renders the supplied live tip', () => {
        render(<CoachingCard sessionState="during" liveTip={<span data-testid="tip">Pause instead of um</span>} />);
        expect(screen.getByTestId('coaching-live')).toContainElement(screen.getByTestId('tip'));
    });

    it('during → renders a Focus Points nudge on ink when there is no tip', () => {
        render(<CoachingCard sessionState="during" nudge="Two down — point 3 whenever you're ready." />);
        expect(screen.getByTestId('coverage-pace-nudge')).toHaveTextContent("Two down — point 3 whenever you're ready.");
    });

    it('during → silent keeps the resting line', () => {
        render(<CoachingCard sessionState="during" nudge="   " />);
        expect(screen.getByText('Tips appear as you speak.')).toBeInTheDocument();
        expect(screen.queryByTestId('coverage-pace-nudge')).toBeNull();
    });

    it('after → renders the supplied verdict', () => {
        render(<CoachingCard sessionState="after" verdict={<span data-testid="v">Cleanest session yet</span>} />);
        expect(screen.getByTestId('coaching-verdict')).toContainElement(screen.getByTestId('v'));
    });
});
