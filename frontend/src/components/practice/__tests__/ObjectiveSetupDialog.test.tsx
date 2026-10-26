import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createRoot, type Root } from 'react-dom/client';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ObjectiveSetupDialog } from '../ObjectiveSetupDialog';

// Stub the capture form so this test isolates the DIALOG's job: mount the form when open and forward
// its onReady up to the caller. The form's own submit/validation is covered in ObjectiveSetupForm.test.
// The native select stands in for the form's topic picker; it consumes Escape only when asked to.
vi.mock('@/components/session/ObjectiveSetupForm', () => ({
    ObjectiveSetupForm: ({ onReady }: { onReady: (r: { briefId: string; projectId: string; points: string[] }) => void }) => (
        <>
            <button data-testid="stub-form-ready" onClick={() => onReady({ briefId: 'b1', projectId: 'p1', points: ['Name the price'] })}>
                form
            </button>
            <select
                data-testid="stub-select"
                onKeyDown={(e) => { if (e.key === 'Escape' && e.currentTarget.dataset.consume === 'true') e.preventDefault(); }}
            >
                <option>topic</option>
            </select>
        </>
    ),
}));

describe('ObjectiveSetupDialog (#1046 slice 5b)', () => {
    it('renders the capture form when open and forwards onReady to the caller', () => {
        const onReady = vi.fn();
        render(<ObjectiveSetupDialog open onOpenChange={vi.fn()} onReady={onReady} />);
        expect(screen.getByTestId('objective-setup-dialog')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('stub-form-ready'));
        expect(onReady).toHaveBeenCalledWith({ briefId: 'b1', projectId: 'p1', points: ['Name the price'] });
    });

    it('renders nothing when closed', () => {
        render(<ObjectiveSetupDialog open={false} onOpenChange={vi.fn()} onReady={vi.fn()} />);
        expect(screen.queryByTestId('objective-setup-dialog')).not.toBeInTheDocument();
    });
});

/**
 * G17 (#1709 trace, main CI 40221511490 attempt 1): Header → Products → Focus Points. The closing Products menu is a
 * Radix dismissable layer registered BEFORE the dialog. Radix's Escape check compares the dialog's index from its last
 * render with the live layer count, and the menu's unmount only schedules the dialog's re-render. An Escape in that gap
 * reached no layer, so the dialog stayed open with ?product=focus-points.
 */
describe('ObjectiveSetupDialog Escape (G17)', () => {
    let menuRoot: Root | null = null;
    let menuHost: HTMLElement | null = null;
    afterEach(() => {
        if (menuRoot) act(() => menuRoot?.unmount());
        menuRoot = null;
        menuHost?.remove();
        menuHost = null;
    });

    const escape = () => new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

    /** The Products menu's layer mounts first, the dialog's second, then the menu leaves without letting React re-render. */
    const dialogAfterDepartingMenu = (onOpenChange: (open: boolean) => void) => {
        menuHost = document.createElement('div');
        document.body.appendChild(menuHost);
        menuRoot = createRoot(menuHost);
        act(() => menuRoot!.render(
            <DropdownMenu open modal={false}>
                <DropdownMenuTrigger>Products</DropdownMenuTrigger>
                <DropdownMenuContent><DropdownMenuItem>Focus Points</DropdownMenuItem></DropdownMenuContent>
            </DropdownMenu>,
        ));
        render(<ObjectiveSetupDialog open onOpenChange={onOpenChange} onReady={vi.fn()} />);
        const root = menuRoot;
        menuRoot = null;
        root.unmount(); // outside act: the menu's layer is deleted, the dialog's re-render is only scheduled
    };

    it('closes on an Escape sent while the departing Products menu leaves the layer stack', () => {
        const onOpenChange = vi.fn();
        dialogAfterDepartingMenu(onOpenChange);
        screen.getByTestId('objective-setup-dialog').dispatchEvent(escape());
        expect(onOpenChange).toHaveBeenCalledTimes(1);
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('CONTROL: once the dialog has re-rendered, the same Escape closes through Radix, exactly once', async () => {
        const onOpenChange = vi.fn();
        dialogAfterDepartingMenu(onOpenChange);
        // Let React run the re-render the menu's departure scheduled: the dialog's index now matches the live stack.
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
        screen.getByTestId('objective-setup-dialog').dispatchEvent(escape());
        expect(onOpenChange).toHaveBeenCalledTimes(1);
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('does not close when a child consumed that Escape (native select, defaultPrevented)', () => {
        const onOpenChange = vi.fn();
        dialogAfterDepartingMenu(onOpenChange);
        const select = screen.getByTestId('stub-select');
        select.dataset.consume = 'true';
        select.dispatchEvent(escape());
        expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('CONTROL: a normal Escape from inside a native select closes exactly once', () => {
        const onOpenChange = vi.fn();
        render(<ObjectiveSetupDialog open onOpenChange={onOpenChange} onReady={vi.fn()} />);
        fireEvent.keyDown(screen.getByTestId('stub-select'), { key: 'Escape' });
        expect(onOpenChange).toHaveBeenCalledTimes(1);
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});
