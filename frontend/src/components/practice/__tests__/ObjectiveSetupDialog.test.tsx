import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ObjectiveSetupDialog } from '../ObjectiveSetupDialog';

// Stub the capture form so this test isolates the DIALOG's job: mount the form when open and forward
// its onReady up to the caller. The form's own submit/validation is covered in ObjectiveSetupForm.test.
vi.mock('@/components/session/ObjectiveSetupForm', () => ({
    ObjectiveSetupForm: ({ onReady }: { onReady: (r: { briefId: string; projectId: string }) => void }) => (
        <button data-testid="stub-form-ready" onClick={() => onReady({ briefId: 'b1', projectId: 'p1' })}>
            form
        </button>
    ),
}));

describe('ObjectiveSetupDialog (#1046 slice 5b)', () => {
    it('renders the capture form when open and forwards onReady to the caller', () => {
        const onReady = vi.fn();
        render(<ObjectiveSetupDialog open onOpenChange={vi.fn()} onReady={onReady} />);
        expect(screen.getByTestId('objective-setup-dialog')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('stub-form-ready'));
        expect(onReady).toHaveBeenCalledWith({ briefId: 'b1', projectId: 'p1' });
    });

    it('renders nothing when closed', () => {
        render(<ObjectiveSetupDialog open={false} onOpenChange={vi.fn()} onReady={vi.fn()} />);
        expect(screen.queryByTestId('objective-setup-dialog')).not.toBeInTheDocument();
    });
});
