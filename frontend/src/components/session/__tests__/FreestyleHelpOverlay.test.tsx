import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { FreestyleHelpOverlay } from '../FreestyleHelpOverlay';

const TITLE = 'How Freestyle Practice works';
const INTRO = "No agenda required. Choose a transcription method, start when you're ready, and speak freely.";
const STEPS = [
    'Choose your transcription method.',
    'Start when you are ready.',
    'Speak freely.',
    'Stop and wait while the recording is saved.',
    'Review your transcript and available delivery feedback.',
    'Choose one improvement for the next attempt.',
];
const FEEDBACK =
    'After you stop, SpeakSharp saves your transcript and shows the delivery feedback available for that session.';
const DISABLED_REASON = 'Finish the current recording, save, or recovery step to view this guide.';

describe('FreestyleHelpOverlay (#1042 PR2)', () => {
    it('renders a secondary outlined trigger button and does NOT auto-open', () => {
        render(<FreestyleHelpOverlay available />);
        const btn = screen.getByTestId('freestyle-help-button');
        expect(btn).toHaveTextContent(TITLE);
        expect(btn).toHaveAccessibleName(TITLE);
        // Never auto-open.
        expect(screen.queryByTestId('freestyle-help-overlay')).not.toBeInTheDocument();
    });

    it('opens on click and shows the approved introduction, six steps, and feedback statement', () => {
        render(<FreestyleHelpOverlay available />);
        fireEvent.click(screen.getByTestId('freestyle-help-button'));
        const overlay = screen.getByTestId('freestyle-help-overlay');
        expect(within(overlay).getByText(TITLE)).toBeInTheDocument();
        expect(within(overlay).getByText(INTRO)).toBeInTheDocument();
        const steps = within(screen.getByTestId('freestyle-help-steps')).getAllByRole('listitem');
        expect(steps.map((li) => li.textContent)).toEqual(STEPS);
        expect(screen.getByTestId('freestyle-help-feedback')).toHaveTextContent(FEEDBACK);
    });

    it('closes on Escape and returns focus to the trigger button', async () => {
        render(<FreestyleHelpOverlay available />);
        const btn = screen.getByTestId('freestyle-help-button');
        fireEvent.click(btn);
        expect(screen.getByTestId('freestyle-help-overlay')).toBeInTheDocument();
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByTestId('freestyle-help-overlay')).not.toBeInTheDocument());
        await waitFor(() => expect(btn).toHaveFocus());
    });

    it('closes via the built-in Close control', async () => {
        render(<FreestyleHelpOverlay available />);
        fireEvent.click(screen.getByTestId('freestyle-help-button'));
        fireEvent.click(screen.getByRole('button', { name: /close/i }));
        await waitFor(() => expect(screen.queryByTestId('freestyle-help-overlay')).not.toBeInTheDocument());
    });

    it('when unavailable: aria-disabled, cannot open, and exposes the persistent accessible explanation', () => {
        render(<FreestyleHelpOverlay available={false} />);
        const btn = screen.getByTestId('freestyle-help-button');
        expect(btn).toHaveAttribute('aria-disabled', 'true');
        // The disabled explanation is announced as the accessible description (persistent, not a tooltip).
        expect(btn).toHaveAccessibleDescription(DISABLED_REASON);
        // Activation is blocked.
        fireEvent.click(btn);
        expect(screen.queryByTestId('freestyle-help-overlay')).not.toBeInTheDocument();
    });

    it('does not overstate feedback and never claims navigation/recording', () => {
        render(<FreestyleHelpOverlay available />);
        fireEvent.click(screen.getByTestId('freestyle-help-button'));
        const overlay = screen.getByTestId('freestyle-help-overlay');
        expect(overlay.textContent ?? '').not.toMatch(/start recording now|opens the session|navigat/i);
    });
});
