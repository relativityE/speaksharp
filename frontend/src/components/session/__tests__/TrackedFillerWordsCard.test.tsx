import { render, screen, fireEvent, within } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { TrackedFillerWordsCard } from '../TrackedFillerWordsCard';
import { FILLER_WORD_KEYS } from '@/config';

const CUSTOM_WORD = 'antigravity';
// The manager reads the whole hook, so the double is the whole contract: one saved custom word.
vi.mock('@/hooks/useUserFillerWords', () => ({
    useUserFillerWords: () => ({
        userFillerWords: [CUSTOM_WORD],
        fullVocabularyObjects: [{ id: 'w1', word: CUSTOM_WORD }],
        isLoading: false,
        error: null,
        addWord: vi.fn(),
        removeWord: vi.fn(),
        isAdding: false,
        isRemoving: false,
        count: 1,
        maxWords: 10,
        isPro: true,
    }),
}));

// G16 D3 — the filler-word control is its own rail card with an ink `Edit` link (it left the transcript header).
describe('TrackedFillerWordsCard (G16 D3)', () => {
    it('states how many words are tracked, from the real list rather than a hard-coded number', () => {
        render(<TrackedFillerWordsCard />);
        expect(screen.getByTestId('tracked-filler-words-count'))
            .toHaveTextContent(`Tracking ${Object.values(FILLER_WORD_KEYS).length + 1} filler words`);
    });

    it('CASUALTY: the Edit control is an underlined INK link, never the yellow action colour', () => {
        render(<TrackedFillerWordsCard />);
        const edit = screen.getByRole('button', { name: 'Edit tracked filler words' });
        expect(edit).toHaveTextContent('Edit');
        expect(edit).toHaveAttribute('data-testid', 'add-custom-word-button');
        expect(edit.className).toContain('underline');
        expect(edit.className).not.toMatch(/signature/);
    });

    it('opens the custom-word manager', () => {
        render(<TrackedFillerWordsCard />);
        expect(screen.queryByPlaceholderText(/literally/i)).toBeNull();
        fireEvent.click(screen.getByTestId('add-custom-word-button'));
        expect(screen.getByPlaceholderText(/literally/i)).toBeInTheDocument();
    });

    // The chip list that shipped in #1506 named each custom word a second time inside the same popover.
    // `user-filler-words.e2e` then failed a post-removal check with a strict-mode violation (two matches),
    // intermittently on `main@289da05a`. One word, one place: the manager's list, whose entries can be removed.
    it('CASUALTY: a custom word appears exactly ONCE in the open popover', async () => {
        render(<TrackedFillerWordsCard />);
        fireEvent.click(screen.getByTestId('add-custom-word-button'));
        expect(screen.queryByTestId('tracked-filler-list')).toBeNull();
        const badges = await screen.findAllByTestId('filler-word-badge');
        const custom = badges.filter((badge) => badge.textContent === CUSTOM_WORD);
        expect(custom).toHaveLength(1);
        expect(within(document.body).getAllByText(CUSTOM_WORD)).toHaveLength(1);
    });
});
