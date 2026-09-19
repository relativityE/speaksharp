import { render, screen, fireEvent } from '../../../../tests/support/test-utils';
import { describe, it, expect } from 'vitest';
import { TrackedFillerWordsCard } from '../TrackedFillerWordsCard';
import { FILLER_WORD_KEYS } from '@/config';

// G16 D3 — the filler-word control is its own rail card with an ink `Edit` link (it left the transcript header).
describe('TrackedFillerWordsCard (G16 D3)', () => {
    it('states how many words are tracked, from the real list rather than a hard-coded number', () => {
        render(<TrackedFillerWordsCard />);
        expect(screen.getByTestId('tracked-filler-words-count'))
            .toHaveTextContent(`Tracking ${Object.values(FILLER_WORD_KEYS).length} filler words`);
    });

    it('CASUALTY: the Edit control is an underlined INK link, never the yellow action colour', () => {
        render(<TrackedFillerWordsCard />);
        const edit = screen.getByRole('button', { name: 'Edit tracked filler words' });
        expect(edit).toHaveTextContent('Edit');
        expect(edit).toHaveAttribute('data-testid', 'add-custom-word-button');
        expect(edit.className).toContain('underline');
        expect(edit.className).not.toMatch(/signature/);
    });

    it('opens the custom-word manager with the tracked-word list', () => {
        render(<TrackedFillerWordsCard />);
        expect(screen.queryByTestId('tracked-filler-list')).toBeNull();
        fireEvent.click(screen.getByTestId('add-custom-word-button'));
        expect(screen.getByPlaceholderText(/literally/i)).toBeInTheDocument();
        const list = screen.getByTestId('tracked-filler-list');
        expect(list).toHaveTextContent('um');
        expect(list).toHaveTextContent('actually');
    });
});
