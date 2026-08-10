import { describe, it, expect } from 'vitest';
import { fillerTierBreakdown, countedFillerTotal } from '../fillerTiers';

// #1231 filler slice 2 — the headline is the TRUE-filler tier (um/uh/ah) + user words, derived from
// per-key data uniformly across all history; discourse markers count only when opted in.
const perKey = (m: Record<string, number>) => {
    const out: Record<string, { count: number; color: string }> = {};
    for (const k in m) out[k] = { count: m[k], color: '' };
    return out;
};

describe('fillerTierBreakdown (#1231 slice 2)', () => {
    it('splits true fillers, discourse markers, and custom words by tier', () => {
        const b = fillerTierBreakdown(perKey({ um: 3, uh: 1, ah: 1, like: 4, so: 2, myword: 2, total: 999 }));
        expect(b).not.toBeNull();
        expect(b!.trueFillers).toBe(5);            // 3 + 1 + 1
        expect(b!.discourseMarkers).toBe(6);       // like 4 + so 2
        expect(b!.customWords).toBe(2);            // myword
        expect(b!.comprehensiveTotal).toBe(13);    // all valid per-key (total scalar ignored)
    });

    it('NEVER trusts the scalar total.count (legacy all-13 definition)', () => {
        // A legacy row whose total says 20 but per-key shows only 2 um → headline is 2, not 20.
        expect(countedFillerTotal(perKey({ um: 2, total: 20 }))).toBe(2);
    });

    it('default headline = true fillers + custom words (discourse EXCLUDED)', () => {
        expect(countedFillerTotal(perKey({ um: 2, like: 5, so: 3, myword: 1 }))).toBe(3); // 2 + 1
    });

    it('opt-in headline = true + custom + discourse markers', () => {
        expect(countedFillerTotal(perKey({ um: 2, like: 5, so: 3, myword: 1 }), { includeDiscourseMarkers: true }))
            .toBe(11); // 2 + 1 + (5 + 3)
    });

    it('a genuine per-key zero is valid evidence → countedTotal 0 (not null)', () => {
        expect(countedFillerTotal(perKey({ um: 0, uh: 0, like: 0 }))).toBe(0);
    });

    it('no per-key evidence → null (never a flattering 0)', () => {
        expect(countedFillerTotal({})).toBeNull();
        expect(countedFillerTotal({ total: { count: 7 } } as never)).toBeNull(); // total-only NONZERO: cannot tier
        expect(countedFillerTotal(null)).toBeNull();
        expect(countedFillerTotal([] as never)).toBeNull();
    });

    it('total-only ZERO is unambiguous → countedTotal 0 (a legitimate zero data point, not excluded)', () => {
        expect(countedFillerTotal({ total: { count: 0 } } as never)).toBe(0);
    });

    it("a user's explicit custom word ALWAYS counts — even when it collides with a discourse marker", () => {
        // "basically" is a built-in discourse marker, but the user explicitly added it → it counts in the headline.
        expect(countedFillerTotal(perKey({ um: 1, basically: 2 }), { userWords: ['basically'] })).toBe(3);
        const b = fillerTierBreakdown(perKey({ um: 1, basically: 2 }), { userWords: ['basically'] });
        expect(b!.customWords).toBe(2);       // promoted out of the discourse tier
        expect(b!.discourseMarkers).toBe(0);
    });

    it('custom words outside the 13 patterns always count', () => {
        expect(countedFillerTotal(perKey({ um: 1, honestly: 4 }), { userWords: ['honestly'] })).toBe(5);
        // even without being in the passed userWords list, an untracked key is treated as a custom word
        expect(countedFillerTotal(perKey({ um: 1, honestly: 4 }))).toBe(5);
    });

    it('ignores malformed per-key counts (fractional/negative/non-finite)', () => {
        expect(countedFillerTotal(perKey({ um: 2 } as Record<string, number>))).toBe(2);
        expect(fillerTierBreakdown({ um: { count: 2.5 }, uh: { count: 3 } } as never)!.trueFillers).toBe(3);
        expect(fillerTierBreakdown({ um: { count: -1 }, uh: { count: 4 } } as never)!.trueFillers).toBe(4);
    });
});
