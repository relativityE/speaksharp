import { render, screen, fireEvent } from '../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpgradePromptDialog } from '@/components/UpgradePromptDialog';
import { enablePaymentsForTest } from '../../../tests/support/payments';

const mockSupabase = {
    functions: {
        invoke: vi.fn(),
    },
};

vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: () => mockSupabase,
}));

describe('UpgradePromptDialog', () => {
    it('does not render the dialog when open is false', () => {
        render(<UpgradePromptDialog open={false} onOpenChange={() => { }} />);
        expect(screen.queryByText('Keep practicing after your trial')).not.toBeInTheDocument();
    });

    // Fail-closed beta DEFAULT (no local opt-in): the post-session upgrade prompt must surface NO
    // actionable Upgrade control even when open — proving the surface is gated on arePaymentsEnabled().
    it('renders NO actionable Upgrade control when payments are disabled (beta default)', () => {
        render(<UpgradePromptDialog open={true} onOpenChange={() => { }} />);
        expect(screen.queryByTestId('upgrade-prompt-dialog-upgrade-button')).not.toBeInTheDocument();
        expect(screen.queryByText('Upgrade to Pro')).not.toBeInTheDocument();
        expect(screen.queryByText('Keep practicing after your trial')).not.toBeInTheDocument();
    });

    describe('payments enabled (local opt-in via enablePaymentsForTest)', () => {
        beforeEach(() => enablePaymentsForTest());

        it('renders the dialog when open is true', () => {
            render(<UpgradePromptDialog open={true} onOpenChange={() => { }} />);
            expect(screen.getByText('Keep practicing after your trial')).toBeInTheDocument();
            expect(screen.getByText(/Continue for \$10\/month to keep going after it ends\. Private transcription stays on-device/i)).toBeInTheDocument();
            expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument();
            expect(screen.getByText('Maybe Later')).toBeInTheDocument();
        });

        it('calls onOpenChange with false when "Maybe Later" is clicked', () => {
            const onOpenChange = vi.fn();
            render(<UpgradePromptDialog open={true} onOpenChange={onOpenChange} />);
            fireEvent.click(screen.getByText('Maybe Later'));
            expect(onOpenChange).toHaveBeenCalledWith(false);
        });

        it('opens pricing instead of surprise-starting Stripe checkout on "Upgrade to Pro" click', () => {
            const onOpenChange = vi.fn();
            render(<UpgradePromptDialog open={true} onOpenChange={onOpenChange} />);
            fireEvent.click(screen.getByTestId('upgrade-prompt-dialog-upgrade-button'));

            expect(onOpenChange).toHaveBeenCalledWith(false);
            expect(mockSupabase.functions.invoke).not.toHaveBeenCalled();
        });
    });
});
