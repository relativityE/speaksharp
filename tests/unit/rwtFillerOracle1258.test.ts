// @vitest-environment node
/**
 * #1258 (RWT run 37514078995; Consultant-confirmed) — the transcript-vs-saved filler row counted only the exact word, while
 * the product's `um` key also counts `umm`, `ummm` and `uhm`: a transcript with 2 "um" and 3 "umm" read as transcript 2 vs
 * saved 5 although the product counted correctly. Consistency now uses the product's own matcher; the corpus row keeps
 * exact words; per-variant integers name the cause. Synthetic text only.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fillerVariantCounts, productFillerCount, variantEvidence } from '../live/helpers/rwtOracles';
import { countFillerWords } from '../../frontend/src/utils/fillerWordUtils';

const RUN_SHAPE = 'Um, so I think, umm, the plan is um ready. Umm, yes, and umm we ship.';
const exactWord = (text: string, word: string) => (text.toLowerCase().match(new RegExp(`\\b${word}\\b`, 'g')) ?? []).length;

describe('filler oracle uses the product matcher for consistency (run 37514078995)', () => {
    it('CASUALTY: 2 "um" + 3 "umm" — exact word 2, product 5, which equals what the product saves', () => {
        expect(exactWord(RUN_SHAPE, 'um')).toBe(2);
        expect(productFillerCount(RUN_SHAPE, 'um')).toBe(5);
        expect(productFillerCount(RUN_SHAPE, 'um')).toBe(countFillerWords(RUN_SHAPE).um.count);
    });
    it('records every product alternative as an integer, and the variants sum to the product count', () => {
        const variants = fillerVariantCounts(RUN_SHAPE, 'um');
        expect(variants).toEqual({ um: 2, umm: 3, ummm: 0, uhm: 0 });
        expect(Object.values(variants).reduce((a, b) => a + b, 0)).toBe(productFillerCount(RUN_SHAPE, 'um'));
    });
    it('maps the saved key naming (`you_know`) onto the product key (`You Know`)', () => {
        const text = 'You know, it works. Ya know what I mean? you know.';
        expect(productFillerCount(text, 'you_know')).toBe(countFillerWords(text)['You Know'].count);
        expect(productFillerCount(text, 'you_know')).toBe(3);
        expect(fillerVariantCounts(text, 'you_know')).toMatchObject({ 'you know': 2, 'ya know': 1 });
    });
    it('variants match the product EXACTLY (a widened space is not counted), so they always sum to the product count', () => {
        const text = 'you know, then you   know, then ya know';
        const variants = fillerVariantCounts(text, 'you_know');
        expect(productFillerCount(text, 'you_know')).toBe(2);
        expect(Object.values(variants).reduce((a, b) => a + b, 0)).toBe(productFillerCount(text, 'you_know'));
    });
    it('receipt evidence is flat primitives (variant_<token>)', () => {
        expect(variantEvidence({ um: 2, umm: 3, "y'know": 1, 'you know': 0 })).toEqual({ variant_um: 2, variant_umm: 3, variant_y_know: 1, variant_you_know: 0 });
    });
    it('an unknown key counts zero and has no variants (never throws)', () => {
        expect(productFillerCount(RUN_SHAPE, 'not_a_key')).toBe(0);
        expect(fillerVariantCounts(RUN_SHAPE, 'not_a_key')).toEqual({});
    });
});

describe('SOURCE CONTRACT: consistency uses the product matcher; the corpus row keeps exact words', () => {
    const spec = readFileSync(resolve(__dirname, '../live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
    it('the transcript/display/saved row judges productFillerCount and records the exact word and variants', () => {
        const loop = spec.slice(spec.indexOf('for (const [spoken, key] of Object.entries(FILLER_KEY))'), spec.indexOf("receipt.row('filler display matches saved (all words)'"));
        expect(loop).toContain('const inTranscript = productFillerCount(transcript, key);');
        expect(loop).toMatch(/transcriptExactWord: exactWord, \.\.\.variantEvidence\(variants\)/);
    });
    it('the corpus row still compares the EXACT word to the corpus', () => {
        const corpus = spec.slice(spec.indexOf('Object.entries(fixture.entry.groundTruthFillers'));
        expect(corpus).toContain('const inTranscript = occurrences(transcript, spoken);');
    });
});
