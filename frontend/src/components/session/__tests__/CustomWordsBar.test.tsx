import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect } from 'vitest';
import { CustomWordsBar } from '../CustomWordsBar';

// #1222 G1 — the full-width before-state bar: "Tracking N filler words" left, "Add your filler words"
// right (opens the custom-word manager). The manager lives here now, not in the MicCard.
describe('CustomWordsBar (#1222 G1)', () => {
    it('shows the tracked filler-word count — exactly the 13 built-in words when no custom words', () => {
        render(<CustomWordsBar />);
        const bar = screen.getByTestId('custom-words-bar');
        // 13 = the static FILLER_WORD_KEYS set; custom additions add to this (reactive via the hook).
        expect(bar).toHaveTextContent('Tracking 13 filler words');
    });

    it('reveals the custom-word manager when "Add your filler words" is clicked', () => {
        render(<CustomWordsBar />);
        fireEvent.click(screen.getByTestId('add-custom-word-button'));
        expect(screen.getByPlaceholderText(/literally/i)).toBeInTheDocument();
    });

    // PO 2026-08-10: the count must reveal WHICH words are tracked (hover/focus), without growing the bar.
    it('exposes the tracked filler-word list (hover/focus) with the built-in words', () => {
        render(<CustomWordsBar />);
        const trigger = screen.getByTestId('tracked-filler-trigger');
        expect(trigger).toHaveTextContent(/Tracking\s+\d+\s+filler words/i);
        const list = screen.getByTestId('tracked-filler-list');
        // The built-in vocabulary is enumerated in the panel (um / actually are static filler keys).
        expect(list).toHaveTextContent('um');
        expect(list).toHaveTextContent('actually');
    });
});
