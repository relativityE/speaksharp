import { describe, expect, it, vi } from 'vitest';
import { screen, render, fireEvent, waitFor } from '../../../tests/support/test-utils';
import { PromoExpiredDialog } from '../PromoExpiredDialog';

describe('PromoExpiredDialog', () => {
    it('lets expired promo users switch accounts instead of being trapped', async () => {
        const signOut = vi.fn().mockResolvedValue(undefined);
        const onOpenChange = vi.fn();

        render(<PromoExpiredDialog open={true} onOpenChange={onOpenChange} />, {
            route: '/session',
            authMock: {
                signOut,
            },
        });

        fireEvent.click(screen.getByTestId('promo-expired-switch-account'));

        await waitFor(() => {
            expect(signOut).toHaveBeenCalledTimes(1);
        });
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});
