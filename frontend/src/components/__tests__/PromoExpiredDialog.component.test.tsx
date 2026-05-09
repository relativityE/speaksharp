import { describe, expect, it, vi } from 'vitest';
import { screen, render, fireEvent } from '../../../tests/support/test-utils';
import { PromoExpiredDialog } from '../PromoExpiredDialog';

describe('PromoExpiredDialog', () => {
    it('shows only the two primary choices and lets expired promo users continue as free', async () => {
        const onOpenChange = vi.fn();

        render(<PromoExpiredDialog open={true} onOpenChange={onOpenChange} />, {
            route: '/session',
        });

        expect(screen.getByTestId('promo-expired-continue-free')).toBeInTheDocument();
        expect(screen.getByTestId('promo-expired-upgrade-button')).toBeInTheDocument();
        expect(screen.queryByText(/have a promo code/i)).not.toBeInTheDocument();
        expect(screen.queryByTestId('promo-expired-switch-account')).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId('promo-expired-continue-free'));

        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});
