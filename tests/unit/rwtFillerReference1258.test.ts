// @vitest-environment node
/**
 * APP-G1h (Sam 1792982426.848739): the independent filler reference behind the Open Mic `filler "<word>" vs corpus` rows.
 * L1 (run 40071973428 on fb30674e) failed `filler "um" vs corpus` with corpus 4 vs transcript 5 while transcript, display and
 * saved agreed. These controls prove the reference still catches omissions, insertions and counter drift, and that a
 * substitution on synthetic audio is FIXTURE_LIMITED (unverified), never PASS. All inputs are built from the TTS script.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { productFillerCount } from '../live/helpers/rwtFillerOracle';
import {
    alignFillers, corpusWordVerdict, crossCheckCounts, fillerAnnotationsOf, hesitationTotals, integrityVerdict,
    referenceCount, type FillerAnnotation,
} from '../live/helpers/rwtFillerReference';

const FIXTURES = path.join(__dirname, '../fixtures/rwt');
const MANIFEST = JSON.parse(readFileSync(path.join(FIXTURES, 'rwt-fixtures.manifest.json'), 'utf8')) as {
    fixtures: Record<string, { groundTruthFillers: Record<string, number> }>;
};
const ENTRY = MANIFEST.fixtures.open_mic_tts;
const CORPUS = ENTRY.groundTruthFillers;
const ANNOTATIONS: FillerAnnotation[] = fillerAnnotationsOf(ENTRY);
const SCRIPT = /^OPEN_MIC="(.*)"$/m.exec(readFileSync(path.join(FIXTURES, 'generate-rwt-tts-fixtures.sh'), 'utf8'))![1];

const verdict = (word: string, transcript: string, kind: 'synthetic' | 'human' = 'synthetic') =>
    corpusWordVerdict(word, CORPUS[word], transcript, alignFillers(transcript, ANNOTATIONS), kind);

describe('APP-G1h fixture annotations are the TTS script, not the model', () => {
    it('every annotated hesitation directly precedes its unique anchor in the script, and they total the corpus', () => {
        expect(ANNOTATIONS).toHaveLength(8);
        const aligned = alignFillers(SCRIPT, ANNOTATIONS);
        expect(aligned.instances.map((i) => i.class)).toEqual(Array(8).fill('MATCH'));
        expect(Object.values(aligned.inserted).every((n) => n === 0)).toBe(true);
        for (const [word, n] of Object.entries(CORPUS)) {
            expect(ANNOTATIONS.filter((a) => a.word === word)).toHaveLength(n);
        }
    });
});

describe('APP-G1h corpus verdicts: exact per word, substitutions never pass', () => {
    it('a. the exact script passes every corpus word', () => {
        for (const word of Object.keys(CORPUS)) expect(verdict(word, SCRIPT).verdict).toBe('PASS');
    });

    it('b. one scripted "uh" recognised as "um" is FIXTURE_LIMITED for both words, never PASS', () => {
        const t = SCRIPT.replace('Uh, I propose', 'Um, I propose');
        expect(verdict('um', t)).toMatchObject({ verdict: 'FIXTURE_LIMITED', evidence: { transcript: 5, substitutedIn: 1 } });
        expect(verdict('uh', t)).toMatchObject({ verdict: 'FIXTURE_LIMITED', evidence: { substitutedOut: 1 } });
    });

    it('the L1 shape (um 5, ah 2, uh 0; total conserved) is FIXTURE_LIMITED, not PASS and not a counting FAIL', () => {
        const t = SCRIPT.replace('Uh, I propose', 'Um, I propose').replace('Uh, every Friday', 'Ah, every Friday')
            .replace('Uh, I will share', 'Ah, I will share');
        expect([referenceCount(t, 'um'), referenceCount(t, 'uh'), referenceCount(t, 'ah')]).toEqual([5, 0, 2]);
        expect(verdict('um', t).verdict).toBe('FIXTURE_LIMITED');
        expect(hesitationTotals(t, CORPUS)).toEqual({ expected: 7, transcript: 7 });
    });

    it('c. an extra hesitation not before any anchor is INSERTED -> FAIL', () => {
        const t = SCRIPT.replace('We will pilot it', 'We will um pilot it');
        expect(verdict('um', t)).toMatchObject({ verdict: 'FAIL', evidence: { inserted: 1 } });
    });

    it('d. a dropped hesitation is OMITTED -> FAIL', () => {
        const t = SCRIPT.replace('Um, each morning', 'Each morning');
        expect(verdict('um', t)).toMatchObject({ verdict: 'FAIL', evidence: { omitted: 1 } });
    });

    it('e. insertion plus omission with the um count conserved still FAILs (the total alone cannot hide it)', () => {
        const t = SCRIPT.replace('Um, each morning', 'Each morning').replace('We will pilot it', 'We will um pilot it');
        expect(referenceCount(t, 'um')).toBe(CORPUS.um);
        expect(verdict('um', t)).toMatchObject({ verdict: 'FAIL', evidence: { omitted: 1, inserted: 1 } });
    });

    it('f. a garbled anchor HOLDs rather than guessing', () => {
        const t = SCRIPT.replace('every Friday', 'every fry day');
        expect(verdict('uh', t).verdict).toBe('HOLD');
    });

    it('g. a repeated anchor is AMBIGUOUS -> HOLD, and no hesitation is attached twice', () => {
        const t = `${SCRIPT} Um, deadlines live elsewhere too.`;
        const aligned = alignFillers(t, ANNOTATIONS);
        expect(aligned.instances.find((i) => i.anchor === 'deadlines live')?.class).toBe('AMBIGUOUS');
        expect(verdict('um', t).verdict).toBe('HOLD');
        const contested = alignFillers('Um, deadlines live here.', [
            { word: 'um', anchor: 'deadlines live' }, { word: 'um', anchor: 'deadlines' },
        ]);
        expect(contested.instances.map((i) => i.class)).toEqual(['MATCH', 'CONTESTED']);
    });

    it('k. on human audio the same substitution is a FAIL, with no fixture leniency', () => {
        const t = SCRIPT.replace('Uh, I propose', 'Um, I propose');
        expect(verdict('um', t, 'human').verdict).toBe('FAIL');
    });
});

describe('APP-G1h counter independence: drift between product and reference is caught', () => {
    const variants = 'Umm, so. Uhm, right. Uhh, well. Er, then. Ahm, okay. Ahhh. You know, and y\'know, ya know.';

    it('the product counter and the reference agree on the script and on every declared variant', () => {
        for (const text of [SCRIPT, variants]) {
            const checked = crossCheckCounts(text, productFillerCount);
            expect(Object.values(checked).every((c) => c.verdict === 'PASS')).toBe(true);
        }
    });

    it('h. MUTANT: a product counter that stops counting "uhm" FAILs the cross-check', () => {
        const mutant = (text: string, key: string) => productFillerCount(text.replace(/\buhm\b/gi, ''), key);
        expect(crossCheckCounts(variants, mutant).um).toMatchObject({ verdict: 'FAIL', reference: 2, product: 1 });
    });
});

describe('APP-G1h integrity rows stay exact (transcript / display / saved)', () => {
    it('i. a saved count that differs from the transcript FAILs', () => {
        expect(integrityVerdict({ transcript: 5, displayed: 5, saved: 4, rendered: true }).verdict).toBe('FAIL');
    });
    it('j. a displayed count that differs from the saved count FAILs', () => {
        expect(integrityVerdict({ transcript: 5, displayed: 4, saved: 5, rendered: true }).verdict).toBe('FAIL');
    });
    it('CONTROL: agreement passes, and a non-rendered discourse marker compares transcript with saved only', () => {
        expect(integrityVerdict({ transcript: 5, displayed: 5, saved: 5, rendered: true }).verdict).toBe('PASS');
        expect(integrityVerdict({ transcript: 1, displayed: null, saved: 1, rendered: false }).verdict).toBe('PASS');
    });
});
