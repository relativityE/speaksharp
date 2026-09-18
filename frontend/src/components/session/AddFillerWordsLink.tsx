import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { UserFillerWordsManager } from './UserFillerWordsManager';
import { useUserFillerWords } from '@/hooks/useUserFillerWords';
import { FILLER_WORD_KEYS } from '@/config';

/**
 * `Add your filler words` — a text link in the transcript header (Design Correction Brief S-4).
 *
 * It replaces the full-width `Tracking common hesitation sounds` strip that sat under the before-state
 * shell: a whole card for a settings link, the page's fifth surface and its least important. The link keeps
 * the strip's test identity (`add-custom-word-button`), so the flows that add a word before recording are
 * unchanged, and the list of tracked words moves INTO the popover rather than being lost.
 */
const BUILTIN_FILLER_WORDS = Object.values(FILLER_WORD_KEYS);

export const AddFillerWordsLink: React.FC = () => {
    const { userFillerWords } = useUserFillerWords();
    const allWords = [...BUILTIN_FILLER_WORDS, ...userFillerWords];

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    data-testid="add-custom-word-button"
                    className="text-[12px] font-bold text-signature-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature-text focus-visible:ring-offset-2"
                >
                    Add your filler words
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 border-neutral-border bg-white">
                <div data-testid="tracked-filler-list" className="mb-3">
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-neutral-secondary">
                        Tracked words ({allWords.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                        {allWords.map((w, i) => (
                            <span key={`${w}-${i}`} className="rounded-full bg-neutral-band px-2 py-0.5 text-[12px] text-neutral-body">{w}</span>
                        ))}
                    </div>
                </div>
                <UserFillerWordsManager />
            </PopoverContent>
        </Popover>
    );
};
