/**
 * #1258 D4 (PO 2026-10-07: "true fillers only") — one counting rule for every surface.
 *
 * The PO's 7 Oct take showed highlights 2 ("So", "You know"), a session count of 0 and a Recent-sessions count of 1.
 * Two defects: (1) highlights used the tokenizer's all-13 flag while counts used the counting tier; (2) the tier sets
 * use display keys ("You Know") while saved rows use snake_case ("you_know"), so a saved discourse marker missed both
 * sets and was counted as a custom word.
 */
import { describe, expect, it } from 'vitest';
import { countedFillerMap, countedFillerTotal, fillerTierBreakdown, fillerTierKey, isCountedFillerText } from '@/utils/fillerTiers';
import { tokensFromTranscript } from '@/utils/transcriptTokens';

const PO_TRANSCRIPT = 'The tomatoes need more sun. So next week we will move four plants. You know, the soil there is also better. Please let me know.';

describe('#1258 D4 — the counting tier reads saved and live keys the same way', () => {
    it('CASUALTY: a saved { you_know: 1, so: 1 } counts 0 by default, exactly like the live { You Know, so }', () => {
        expect(countedFillerTotal({ you_know: 1, so: 1 })).toBe(0);
        expect(countedFillerTotal({ 'You Know': { count: 1, color: '' }, so: { count: 1, color: '' } } as never)).toBe(0);
        expect(countedFillerMap({ you_know: 1, i_mean: 2, kind_of: 1, sort_of: 1 })).toEqual({});
    });
    it('saved multi-word markers land in the discourse tier and count when opted in', () => {
        expect(fillerTierBreakdown({ you_know: 1, i_mean: 2, um: 3 })).toMatchObject({ trueFillers: 3, discourseMarkers: 3, customWords: 0, countedTotal: 3 });
        expect(countedFillerTotal({ you_know: 1, um: 3 }, { includeDiscourseMarkers: true })).toBe(4);
    });
    it('a genuine custom word still counts, and a user word matches across spellings', () => {
        expect(countedFillerTotal({ basically_kinda: 2 })).toBe(2);
        expect(countedFillerTotal({ you_know: 1 }, { userWords: ['You know'] })).toBe(1);
        expect(fillerTierKey('You_Know')).toBe('you know');
    });
});

describe('#1258 D4 — highlights follow the same rule as the count', () => {
    it('CASUALTY (PO 7 Oct take): "So" and "You know" are not highlighted under the true-filler default', () => {
        const highlighted = tokensFromTranscript(PO_TRANSCRIPT).filter((t) => t.filler && isCountedFillerText(t.text));
        expect(highlighted).toEqual([]);
    });
    it('um and uh are highlighted; a discourse marker only when opted in', () => {
        expect(isCountedFillerText('Um,')).toBe(true);
        expect(isCountedFillerText('uh')).toBe(true);
        expect(isCountedFillerText('You know')).toBe(false);
        expect(isCountedFillerText('You know', { includeDiscourseMarkers: true })).toBe(true);
    });
});
