// @vitest-environment node
/** #1258 D5 (Rev 2 §5.5) — one data statement per driver, with the guide's templates and chips. */
import { describe, it, expect } from 'vitest';
import { ruleStatement } from '../ruleStatement';

const base = { wpm: null, fillersPerSession: null, fillersPerMin: null, clarity: null, pausesPerMin: null };

describe('ruleStatement', () => {
    it('pace under / over the 130–150 target', () => {
        expect(ruleStatement({ ...base, driver: 'pace', wpm: 99.6 })).toEqual({ sentence: 'Your pace averaged 100 words a minute, under the 130–150 target.', metric: 'pace' });
        expect(ruleStatement({ ...base, driver: 'pace', wpm: 171 })).toEqual({ sentence: 'Your pace averaged 171 words a minute, over the 130–150 target.', metric: 'pace' });
    });
    it('fillers, clear delivery and pauses', () => {
        // PO 2026-10-09: the count, then the per-minute rate the focus was chosen on, in plain words.
        expect(ruleStatement({ ...base, driver: 'filler words', fillersPerSession: 2, fillersPerMin: 4.4 })).toEqual({ sentence: 'You averaged 2.0 filler words per session, about 4 a minute.', metric: 'fillers' });
        expect(ruleStatement({ ...base, driver: 'filler words', fillersPerSession: 2, fillersPerMin: 0.6 })).toEqual({ sentence: 'You averaged 2.0 filler words per session, under 1 a minute.', metric: 'fillers' });
        expect(ruleStatement({ ...base, driver: 'clear delivery', clarity: 71.4 })).toEqual({ sentence: 'Your clear delivery averaged 71%.', metric: 'clear delivery' });
        expect(ruleStatement({ ...base, driver: 'pause rhythm', pausesPerMin: 13.25 })).toEqual({ sentence: 'You averaged 13.3 pauses a minute.', metric: 'pauses' });
    });
    it('every signal on target: the on-target sentence and no chip — only when pace, fillers and clarity were measured', () => {
        const measured = { wpm: 140, fillersPerSession: 0, fillersPerMin: 0, clarity: 95, pausesPerMin: null };
        expect(ruleStatement({ ...measured, driver: null })).toEqual({ sentence: 'Pace, fillers and clarity are all on target.', metric: null });
    });
    it('CASUALTY (CLI PM 6048239789): driver null with nothing measurable is NOT "all on target" — no statement', () => {
        expect(ruleStatement({ ...base, driver: null })).toBeNull();
        expect(ruleStatement({ wpm: 140, fillersPerSession: 0, fillersPerMin: 0, clarity: null, pausesPerMin: null, driver: null })).toBeNull();
        expect(ruleStatement({ wpm: null, fillersPerSession: 1, fillersPerMin: 1, clarity: 95, pausesPerMin: null, driver: null })).toBeNull();
    });
    it('CASUALTY: no true statement → no card (missing value, an in-target pace, an unknown driver)', () => {
        expect(ruleStatement({ ...base, driver: 'filler words' })).toBeNull();
        expect(ruleStatement({ ...base, driver: 'filler words', fillersPerSession: 2 })).toBeNull();   // no rate → no true statement
        expect(ruleStatement({ ...base, driver: 'pace', wpm: 140 })).toBeNull();
        expect(ruleStatement({ ...base, driver: 'something else' })).toBeNull();
    });
});
