import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { UpgradePromptDialog } from '@/components/UpgradePromptDialog';

const mockSupabase = {
    functions: {
        invoke: vi.fn(),
    },
};

vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: () => mockSupabase,
}));

vi.mock('@/lib/logger', () => ({
    default: {
        error: vi.fn(),
    },
}));

describe('UpgradePromptDialog', () => {
    it('does not render the dialog when open is false', () => {
        render(<UpgradePromptDialog open={false} onOpenChange={() => { }} />);
        expect(screen.queryByText('Unlock Your Full Potential')).not.toBeInTheDocument();
    });

    it('renders the dialog when open is true', () => {
        render(<UpgradePromptDialog open={true} onOpenChange={() => { }} />);
        expect(screen.getByText('Unlock Your Full Potential')).toBeInTheDocument();
        expect(screen.getByText('View Plans')).toBeInTheDocument();
        expect(screen.getByText('Maybe Later')).toBeInTheDocument();
    });

    it('calls onOpenChange with false when "Maybe Later" is clicked', () => {
        const onOpenChange = vi.fn();
        render(<UpgradePromptDialog open={true} onOpenChange={onOpenChange} />);
        fireEvent.click(screen.getByText('Maybe Later'));
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('calls the upgrade function and redirects on "View Plans" click', async () => {
        vi.mocked(mockSupabase.functions.invoke).mockResolvedValue({
            data: { checkoutUrl: 'https://checkout.stripe.com/pay/abc' },
            error: null,
        });

        Object.defineProperty(window, 'location', {
            value: { href: '' },
            writable: true,
        });

        render(<UpgradePromptDialog open={true} onOpenChange={() => { }} />);
        fireEvent.click(screen.getByTestId('upgrade-prompt-dialog-upgrade-button'));

        await waitFor(() => {
            expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('stripe-checkout');
        });

        expect(window.location.href).toBe('https://checkout.stripe.com/pay/abc');
    });
});
