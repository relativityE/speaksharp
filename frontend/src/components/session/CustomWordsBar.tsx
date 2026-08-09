import React from 'react';
import { Settings } from 'lucide-react';
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
const DEFAULT_TRACKED_COUNT = Object.keys(FILLER_WORD_KEYS).length;

export const CustomWordsBar: React.FC<{ className?: string }> = ({ className }) => {
    const { count } = useUserFillerWords();
    const trackedCount = DEFAULT_TRACKED_COUNT + count;

    return (
        <div
            className={`rounded-xl border border-[#dbe2ec] bg-white p-4 flex items-center justify-between${className ? ` ${className}` : ''}`}
            data-testid="custom-words-bar"
        >
            <span className="text-[13px] font-semibold text-[#414b5c]">
                Tracking {trackedCount} filler words
            </span>
            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-[#0d7d74] hover:bg-[#0d7d74]/10 hover:text-[#0d7d74]"
                        data-testid="add-custom-word-button"
                    >
                        <Settings className="h-4 w-4" aria-hidden="true" />
                        Add your filler words
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 border-[#dbe2ec] bg-white">
                    <UserFillerWordsManager />
                </PopoverContent>
            </Popover>
        </div>
    );
};
