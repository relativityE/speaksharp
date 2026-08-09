import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect } from 'vitest';
import { CustomWordsBar } from '../CustomWordsBar';

// #1222 G1 — the full-width before-state bar: "Tracking N filler words" left, "Add your filler words"
// right (opens the custom-word manager). The manager lives here now, not in the MicCard.
describe('CustomWordsBar (#1222 G1)', () => {
    it('shows the tracked filler-word count', () => {
        render(<CustomWordsBar />);
        const bar = screen.getByTestId('custom-words-bar');
        expect(bar).toHaveTextContent(/Tracking\s+\d+\s+filler words/i);
    });

    it('reveals the custom-word manager when "Add your filler words" is clicked', () => {
        render(<CustomWordsBar />);
        fireEvent.click(screen.getByTestId('add-custom-word-button'));
        expect(screen.getByPlaceholderText(/literally/i)).toBeInTheDocument();
    });
});
