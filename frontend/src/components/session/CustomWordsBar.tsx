import React from 'react';
import { Settings, Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { UserFillerWordsManager } from './UserFillerWordsManager';
import { useUserFillerWords } from '@/hooks/useUserFillerWords';
import { FILLER_WORD_KEYS } from '@/config';

/**
 * #1222 G1 — the custom filler-word manager as a full-width bar at the BOTTOM of the before-state:
 *   left  → "Tracking N filler words" (the total tracked vocabulary)
 *   right → "Add your filler words" (opens the custom-word manager in a popover)
 *
 * The total is the app's built-in filler set PLUS the user's custom words. The built-in count is the
 * number of static filler patterns (FILLER_WORD_KEYS); `useUserFillerWords().count` is the user's custom
 * additions. A fresh user therefore reads "Tracking 13 filler words" (the mockup value) and it ticks up
 * as they add their own.
 */
// The actual built-in filler words (values, not keys) so the hover list reads "um, uh, like…".
const BUILTIN_FILLER_WORDS = Object.values(FILLER_WORD_KEYS);
const DEFAULT_TRACKED_COUNT = BUILTIN_FILLER_WORDS.length;

export const CustomWordsBar: React.FC<{ className?: string }> = ({ className }) => {
    const { count, userFillerWords } = useUserFillerWords();
    const trackedCount = DEFAULT_TRACKED_COUNT + count;
    // Built-in set + the user's own additions — what "Tracking N filler words" is actually counting.
    const allWords = [...BUILTIN_FILLER_WORDS, ...userFillerWords];

    return (
        <div
            // flex-wrap + gap so the "Add your filler words" button drops below the label on very narrow
            // screens (≤320px) instead of forcing horizontal document overflow (the (i) icon widened the
            // label just enough to tip the 320px viewport over). Desktop stays a single row.
            className={`rounded-xl border border-neutral-border bg-white p-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2${className ? ` ${className}` : ''}`}
            data-testid="custom-words-bar"
        >
            {/* PO 2026-08-10: the count alone hid WHICH words are tracked. Reveal the full list on hover/focus
                as a floating panel — the bar keeps its small real estate (the panel is absolutely positioned,
                so it never grows the layout). Focusable so keyboard users get it too. */}
            <div className="group relative">
                <span
                    tabIndex={0}
                    role="button"
                    aria-label={`Tracking common hesitation sounds. Hover or focus to see the ${trackedCount} tracked words.`}
                    data-testid="tracked-filler-trigger"
                    className="inline-flex cursor-help items-center gap-1.5 rounded text-[13px] font-semibold text-neutral-secondary outline-none hover:text-neutral-body focus-visible:ring-2 focus-visible:ring-ring"
                >
                    {/* #1046 filler two-tier (reviewer): show the plain-English concept, not a bare count — a
                        number ("Tracking 13") invites the user to game it and misrepresents the tiering.
                        The exact list + count live behind the (i). */}
                    Tracking common hesitation sounds
                    <Info className="h-[15px] w-[15px] text-neutral-muted" aria-hidden="true" />
                </span>
                <div
                    role="tooltip"
                    data-testid="tracked-filler-list"
                    className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-max max-w-[320px] rounded-lg border border-neutral-border bg-white p-3 shadow-lg group-hover:block group-focus-within:block"
                >
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-neutral-muted">Tracked words ({trackedCount})</p>
                    <div className="flex flex-wrap gap-1.5">
                        {allWords.map((w, i) => (
                            <span key={`${w}-${i}`} className="rounded-full bg-neutral-band px-2 py-0.5 text-[12px] text-neutral-body">{w}</span>
                        ))}
                    </div>
                </div>
            </div>
            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-signature-text hover:bg-signature-ground hover:text-signature-text"
                        data-testid="add-custom-word-button"
                    >
                        <Settings className="h-4 w-4" aria-hidden="true" />
                        Add your filler words
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 border-neutral-border bg-white">
                    <UserFillerWordsManager />
                </PopoverContent>
            </Popover>
        </div>
    );
};
