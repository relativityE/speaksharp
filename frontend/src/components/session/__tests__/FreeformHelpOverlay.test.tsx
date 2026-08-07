import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { FreeformHelpOverlay } from '../FreeformHelpOverlay';
import { PRODUCT_NAMES } from '@/constants/productNames';

// Derive from the single product-name authority so a name trial never breaks this spec (#1149).
const TITLE = `How ${PRODUCT_NAMES.freeform} works`;
// Modal redesign (#1116): three ideas, not six recorder steps — each a bold action + a clause.
const STEP_ACTIONS = [
    "Pick how you're transcribed",
    'Speak as long as you like',
    'Take one thing to improve',
];
const DISABLED_REASON = 'Finish the current recording, save, or recovery step to view this guide.';

describe('FreeformHelpOverlay (#1042 PR2 / #1116 redesign)', () => {
    it('renders the trigger button and does NOT auto-open', () => {
        render(<FreeformHelpOverlay available />);
        const btn = screen.getByTestId('freeform-help-button');
        expect(btn).toHaveTextContent(TITLE);
        expect(btn).toHaveAccessibleName(TITLE);
        expect(screen.queryByTestId('freeform-help-overlay')).not.toBeInTheDocument();
    });

    it('opens on click and shows the title, exactly three steps, and a start CTA', () => {
        render(<FreeformHelpOverlay available />);
        fireEvent.click(screen.getByTestId('freeform-help-button'));
        const overlay = screen.getByTestId('freeform-help-overlay');
        // Title is styled across spans; assert by heading accessible name.
        expect(within(overlay).getByRole('heading', { name: TITLE })).toBeInTheDocument();
        const items = within(screen.getByTestId('freeform-help-steps')).getAllByRole('listitem');
        expect(items).toHaveLength(3);
        for (const action of STEP_ACTIONS) {
            expect(within(overlay).getByText(action)).toBeInTheDocument();
        }
        expect(within(overlay).getByTestId('freeform-help-start')).toHaveTextContent(/got it — start speaking/i);
    });

    it('primary CTA closes the modal and calls onStart', async () => {
        const onStart = vi.fn();
        render(<FreeformHelpOverlay available onStart={onStart} />);
        fireEvent.click(screen.getByTestId('freeform-help-button'));
        fireEvent.click(screen.getByTestId('freeform-help-start'));
        await waitFor(() => expect(screen.queryByTestId('freeform-help-overlay')).not.toBeInTheDocument());
        expect(onStart).toHaveBeenCalledTimes(1);
    });

    it('closes on Escape and returns focus to the trigger button', async () => {
        render(<FreeformHelpOverlay available />);
        const btn = screen.getByTestId('freeform-help-button');
        fireEvent.click(btn);
        expect(screen.getByTestId('freeform-help-overlay')).toBeInTheDocument();
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByTestId('freeform-help-overlay')).not.toBeInTheDocument());
        await waitFor(() => expect(btn).toHaveFocus());
    });

    it('closes via the built-in Close control', async () => {
        render(<FreeformHelpOverlay available />);
        fireEvent.click(screen.getByTestId('freeform-help-button'));
        fireEvent.click(screen.getByRole('button', { name: /close/i }));
        await waitFor(() => expect(screen.queryByTestId('freeform-help-overlay')).not.toBeInTheDocument());
    });

    it('when unavailable: aria-disabled, cannot open, and exposes the persistent accessible explanation', () => {
        render(<FreeformHelpOverlay available={false} />);
        const btn = screen.getByTestId('freeform-help-button');
        expect(btn).toHaveAttribute('aria-disabled', 'true');
        expect(btn).toHaveAccessibleDescription(DISABLED_REASON);
        fireEvent.click(btn);
        expect(screen.queryByTestId('freeform-help-overlay')).not.toBeInTheDocument();
    });

    it('never claims navigation/auto-recording', () => {
        render(<FreeformHelpOverlay available />);
        fireEvent.click(screen.getByTestId('freeform-help-button'));
        const overlay = screen.getByTestId('freeform-help-overlay');
        expect(overlay.textContent ?? '').not.toMatch(/start recording now|opens the session|navigat/i);
    });
});
