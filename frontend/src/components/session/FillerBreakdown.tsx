import React from 'react';
import { Settings } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { UserFillerWordsManager } from './UserFillerWordsManager';
import type { FillerCounts } from '@/utils/fillerWordUtils';

/**
 * #1231 R2 — the after-state filler breakdown: a lean, ranked per-word list ("um ×4 · like ×2 · you know
 * ×1") so the user can see *which* fillers to target next, plus the "Add your filler words" manager to
 * personalise what's tracked. This is the on-session actionable view; the Analytics page keeps the deeper
 * cross-session trend. It sits quietly under the transcript — it never competes with the verdict/progress.
 *
 * The full legacy `FillerWordsCard` (before/zero/counts state machine, badges, explanation) is retired by
 * the redesign; this keeps only the parts that make fillers actionable on-session.
 */
export interface FillerBreakdownProps {
    fillerData?: FillerCounts | null;
    /** Thin stats line, e.g. "5 fillers · 142 wpm · 2:04 spoken". */
    stats?: string;
    /** Max words shown before "+N more". */
    maxWords?: number;
}

/** Ranked per-word counts (desc), excluding the synthetic `total` key and zero/invalid counts. */
function rankedFillers(fillerData?: FillerCounts | null): { word: string; count: number }[] {
    if (!fillerData || typeof fillerData !== 'object') return [];
    const rows: { word: string; count: number }[] = [];
    for (const word in fillerData) {
        if (word === 'total') continue;
        const count = (fillerData as Record<string, { count?: unknown }>)[word]?.count;
        if (typeof count === 'number' && Number.isFinite(count) && count > 0) rows.push({ word, count });
    }
    return rows.sort((a, b) => b.count - a.count);
}

export const FillerBreakdown: React.FC<FillerBreakdownProps> = ({ fillerData, stats, maxWords = 6 }) => {
    const [managerOpen, setManagerOpen] = React.useState(false);
    const ranked = rankedFillers(fillerData);
    const shown = ranked.slice(0, maxWords);
    const extra = ranked.length - shown.length;

    return (
        <div className="flex flex-col gap-2" data-testid="filler-breakdown">
            <div className="flex items-center justify-between gap-3">
                {stats && <span className="text-[12px] text-[#414b5c]" data-testid="after-stats">{stats}</span>}
                <Popover open={managerOpen} onOpenChange={setManagerOpen}>
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

            {shown.length > 0 ? (
                <ul className="flex flex-wrap items-center gap-1.5" data-testid="filler-breakdown-list">
                    {shown.map(({ word, count }) => (
                        <li
                            key={word}
                            data-testid="filler-breakdown-word"
                            data-word={word}
                            className="flex items-center gap-1 rounded-full bg-[#fdf3e2] px-2 py-0.5 text-[12px] font-semibold text-[#241503]"
                        >
                            <span>{word}</span>
                            <span className="text-[#a8571f]" data-testid="filler-breakdown-count">×{count}</span>
                        </li>
                    ))}
                    {extra > 0 && <li className="text-[12px] text-[#414b5c]">+{extra} more</li>}
                </ul>
            ) : (
                <p className="text-[12px] text-[#414b5c]" data-testid="filler-breakdown-empty">
                    No filler words detected this session.
                </p>
            )}
        </div>
    );
};
