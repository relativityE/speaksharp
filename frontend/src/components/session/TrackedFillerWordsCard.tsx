import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { UserFillerWordsManager } from './UserFillerWordsManager';
import { useUserFillerWords } from '@/hooks/useUserFillerWords';
import { FILLER_WORD_KEYS } from '@/config';

/**
 * G16 / SESSION_BEFORE_DELTA D3 — the filler-word control as its own small rail card, under the progress card.
 *
 * In the transcript header it was a yellow link beside a yellow button inside the same card: three yellows
 * in one row when `before` offers exactly one action. Here it is an underlined ink `Edit` link, and the
 * tracked-word count states what is already being listened for. The trigger keeps the
 * `add-custom-word-button` identity, so every flow that adds a word before recording is unchanged.
 */
const BUILTIN_FILLER_WORDS = Object.values(FILLER_WORD_KEYS);

export const TrackedFillerWordsCard: React.FC = () => {
    const { userFillerWords } = useUserFillerWords();
    const allWords = [...BUILTIN_FILLER_WORDS, ...userFillerWords];
    return (
        <section
            className="flex items-center justify-between gap-3 rounded-[14px] border border-neutral-border-strong bg-neutral-page px-5 py-4"
            data-testid="tracked-filler-words-card"
            aria-label="Tracked filler words"
        >
            <p className="text-[14px] font-bold text-neutral-body" data-testid="tracked-filler-words-count">
                Tracking {allWords.length} filler words
            </p>
            <Popover>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        data-testid="add-custom-word-button"
                        aria-label="Edit tracked filler words"
                        className="text-[14px] font-bold text-neutral-body underline underline-offset-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                        Edit
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
        </section>
    );
};
