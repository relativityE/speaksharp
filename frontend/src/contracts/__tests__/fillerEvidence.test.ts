import { describe, expect, it } from 'vitest';
import { fillerEvidenceKind, measuredFillerTotal, persistedFillerEvidence, validWordCount } from '../fillerEvidence';

// #1472 — one filler-evidence rule for the live review and every persisted surface (Browser PM 6102096434).

describe('fillerEvidenceKind — the shared rule', () => {
    it('a positive count is observed — even when the word count says no speech (inconsistent inputs keep the truthful count)', () => {
        expect(fillerEvidenceKind({ available: true, total: 2, words: 120 })).toBe('observed');
        expect(fillerEvidenceKind({ available: true, total: 1, words: 0 })).toBe('observed');
        expect(fillerEvidenceKind({ available: true, total: 1, words: null })).toBe('observed');
    });
    it('a zero over words is unobservable; no words is no_speech; an unknown word count is unavailable', () => {
        expect(fillerEvidenceKind({ available: true, total: 0, words: 120 })).toBe('unobservable');
        expect(fillerEvidenceKind({ available: true, total: 0, words: 0 })).toBe('no_speech');
        expect(fillerEvidenceKind({ available: true, total: 0, words: null })).toBe('unavailable');
    });
    it('an unavailable map is unavailable whatever the word count says', () => {
        for (const words of [null, 0, 120]) expect(fillerEvidenceKind({ available: false, total: 0, words })).toBe('unavailable');
    });
    it('CASUALTY: a non-integer, negative or non-finite word count is not authority for a zero', () => {
        for (const words of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect({ words, kind: fillerEvidenceKind({ available: true, total: 0, words }) }).toEqual({ words, kind: 'unavailable' });
        }
    });
});

describe('validWordCount', () => {
    it('accepts only finite non-negative integers', () => {
        expect([0, 1, 120].map(validWordCount)).toEqual([0, 1, 120]);
        for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '120', null, undefined, {}]) expect(validWordCount(bad)).toBeNull();
    });
});

describe('persistedFillerEvidence — saved sessions (filler_counts + total_words)', () => {
    it('observed counts keep their total and map', () => {
        expect(persistedFillerEvidence({ filler_counts: { um: 2, uh: 1 }, total_words: 140 })).toEqual({ kind: 'observed', total: 3, counts: { um: 2, uh: 1 } });
        expect(persistedFillerEvidence({ filler_counts: { um: 1 }, total_words: 0 })).toMatchObject({ kind: 'observed', total: 1 });
    });
    it('CASUALTY: an empty map over saved words is unobservable — never a clean or scorable zero', () => {
        const e = persistedFillerEvidence({ filler_counts: {}, total_words: 140 });
        expect(e).toEqual({ kind: 'unobservable' });
        expect(measuredFillerTotal(e)).toBeNull();
    });
    it('an empty map with zero words is no_speech, distinct from unobservable', () => {
        expect(persistedFillerEvidence({ filler_counts: {}, total_words: 0 })).toEqual({ kind: 'no_speech' });
    });
    it('CASUALTY: an empty map with a missing or invalid word count is unavailable (legacy rows withheld, never zero)', () => {
        for (const total_words of [undefined, null, '140', -3, 1.2]) {
            expect({ total_words, e: persistedFillerEvidence({ filler_counts: {}, total_words }) }).toEqual({ total_words, e: { kind: 'unavailable' } });
        }
    });
    it('CASUALTY: an absent or invalid filler map is unavailable', () => {
        for (const filler_counts of [undefined, null, [], 'um', { um: 'x' }, { notAFiller: 2 }]) {
            expect(persistedFillerEvidence({ filler_counts, total_words: 140 }).kind).toBe('unavailable');
        }
    });
});

describe('parity and no invented zero', () => {
    const maps: Array<[unknown, boolean, number]> = [[{}, true, 0], [{ um: 2 }, true, 2], [null, false, 0]];
    const words: unknown[] = [0, 7, 140, null, -1, 2.5];
    it('the persisted reader and the in-memory rule agree for every map × word-count input', () => {
        for (const [filler_counts, available, total] of maps) {
            for (const w of words) {
                const persisted = persistedFillerEvidence({ filler_counts, total_words: w }).kind;
                const inMemory = fillerEvidenceKind({ available, total, words: validWordCount(w) });
                expect({ filler_counts, w, persisted }).toEqual({ filler_counts, w, persisted: inMemory });
            }
        }
    });
    it('nothing produces verified_zero, and only observed evidence yields a metric total', () => {
        for (const [filler_counts] of maps) {
            for (const w of words) {
                const e = persistedFillerEvidence({ filler_counts, total_words: w });
                expect(e.kind).not.toBe('verified_zero');
                expect(measuredFillerTotal(e) === null).toBe(e.kind !== 'observed');
            }
        }
    });
});
