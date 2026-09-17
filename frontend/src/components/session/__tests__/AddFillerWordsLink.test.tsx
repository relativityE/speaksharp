import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect } from 'vitest';
import { AddFillerWordsLink } from '../AddFillerWordsLink';

// Design Correction Brief S-4 — the settings strip became a text link in the transcript header.
describe('AddFillerWordsLink (S-4)', () => {
    it('is a real button, labelled by its visible text', () => {
        render(<AddFillerWordsLink />);
        const link = screen.getByRole('button', { name: 'Add your filler words' });
        expect(link).toHaveAttribute('data-testid', 'add-custom-word-button');
    });

    it('opens the custom-word manager', () => {
        render(<AddFillerWordsLink />);
        fireEvent.click(screen.getByTestId('add-custom-word-button'));
        expect(screen.getByPlaceholderText(/literally/i)).toBeInTheDocument();
    });

    it('keeps the tracked-word list the strip used to show, inside the popover', () => {
        render(<AddFillerWordsLink />);
        expect(screen.queryByTestId('tracked-filler-list')).toBeNull();
        fireEvent.click(screen.getByTestId('add-custom-word-button'));
        const list = screen.getByTestId('tracked-filler-list');
        expect(list).toHaveTextContent('um');
        expect(list).toHaveTextContent('actually');
    });
});
