import { render, screen } from '../../../../tests/support/test-utils';
import { describe, it, expect } from 'vitest';
import { CoachingCard } from '../CoachingCard';

// #1222 slot D — one component, content changes per state, wrapper stable (spec §1).
describe('CoachingCard (#1222 slot D)', () => {
    it('before → LIVE COACHING placeholder line', () => {
        render(<CoachingCard sessionState="before" />);
        expect(screen.getByTestId('coaching-placeholder')).toBeInTheDocument();
        expect(screen.getByText(/first tip appears here/i)).toBeInTheDocument();
        expect(screen.getByTestId('coaching-card')).toHaveAttribute('data-coaching-state', 'before');
    });

    it('during → renders the supplied live tip', () => {
        render(<CoachingCard sessionState="during" liveTip={<span data-testid="tip">Pause instead of um</span>} />);
        expect(screen.getByTestId('coaching-live')).toContainElement(screen.getByTestId('tip'));
    });

    it('after → renders the supplied verdict', () => {
        render(<CoachingCard sessionState="after" verdict={<span data-testid="v">Cleanest session yet</span>} />);
        expect(screen.getByTestId('coaching-verdict')).toContainElement(screen.getByTestId('v'));
    });
});
