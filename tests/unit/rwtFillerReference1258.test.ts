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
    alignFillers, corpusVerdicts, corpusWordVerdict, crossCheckCounts, fillerAnnotationsOf, hesitationTotals, integrityVerdict,
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
        expect(contested.instances.map((i) => i.class)).toEqual(['CONTESTED', 'CONTESTED']);
    });

    // Sam RETURN 1792983339.704229: a contested claim must invalidate EVERY involved attachment, in either order and across
    // words, so neither row can PASS on a hesitation another annotation also claims.
    const OVERLAP = 'Um, deadlines live here.';
    const overlapVerdicts = (annotations: FillerAnnotation[]) => {
        const aligned = alignFillers(OVERLAP, annotations);
        return {
            classes: aligned.instances.map((i) => i.class),
            um: corpusWordVerdict('um', 1, OVERLAP, aligned, 'synthetic').verdict,
            uh: corpusWordVerdict('uh', 1, OVERLAP, aligned, 'synthetic').verdict,
        };
    };

    it('g2. cross-word overlapping anchors contest the shared hesitation: no affected row PASSes', () => {
        expect(overlapVerdicts([{ word: 'um', anchor: 'deadlines live' }, { word: 'uh', anchor: 'deadlines' }]))
            .toEqual({ classes: ['CONTESTED', 'CONTESTED'], um: 'HOLD', uh: 'HOLD' });
    });

    it('g3. the same overlap in reversed annotation order gives the same HOLDs', () => {
        expect(overlapVerdicts([{ word: 'uh', anchor: 'deadlines' }, { word: 'um', anchor: 'deadlines live' }]))
            .toEqual({ classes: ['CONTESTED', 'CONTESTED'], um: 'HOLD', uh: 'HOLD' });
    });

    // Sam 1792983480.096009: annotation ownership is validated before and independently of any hesitation token.
    const ownership = (transcript: string, annotations: FillerAnnotation[]) => {
        const aligned = alignFillers(transcript, annotations);
        return {
            classes: aligned.instances.map((i) => i.class),
            um: corpusWordVerdict('um', 1, transcript, aligned, 'synthetic').verdict,
            uh: corpusWordVerdict('uh', 1, transcript, aligned, 'synthetic').verdict,
        };
    };

    it('g4. the same anchor declared twice with no hesitation present is AMBIGUOUS -> HOLD (not two OMITTED FAILs), in either order', () => {
        const held = { classes: ['AMBIGUOUS', 'AMBIGUOUS'], um: 'HOLD', uh: 'HOLD' };
        expect(ownership('Deadlines live here.', [{ word: 'um', anchor: 'deadlines live' }, { word: 'uh', anchor: 'deadlines live' }])).toEqual(held);
        expect(ownership('Deadlines live here.', [{ word: 'uh', anchor: 'deadlines live' }, { word: 'um', anchor: 'deadlines live' }])).toEqual(held);
    });

    it('g5. partially overlapping anchors are CONTESTED -> HOLD for both, in either order', () => {
        const held = { classes: ['CONTESTED', 'CONTESTED'], um: 'HOLD', uh: 'HOLD' };
        expect(ownership('Um, deadlines live here.', [{ word: 'um', anchor: 'deadlines live' }, { word: 'uh', anchor: 'live here' }])).toEqual(held);
        expect(ownership('Um, deadlines live here.', [{ word: 'uh', anchor: 'live here' }, { word: 'um', anchor: 'deadlines live' }])).toEqual(held);
    });

    it('l. an undeclared alphanumeric word is never a filler: "um2 deadlines live" does not MATCH and does not PASS', () => {
        const t = 'um2 deadlines live here.';
        const aligned = alignFillers(t, [{ word: 'um', anchor: 'deadlines live' }]);
        expect(aligned.instances[0].class).toBe('OMITTED');
        expect(corpusWordVerdict('um', 1, t, aligned, 'synthetic').verdict).toBe('FAIL');
        expect([referenceCount('um2 um_x', 'um'), referenceCount('Um-hmm, um\'s point', 'um')]).toEqual([0, 2]);
    });

    // Sam 1792984173.303649: a variant's internal separator is literal; only the outer boundaries follow the word rule.
    it('n. declared "y\'know" matches, but undeclared "y know", "y-know" and "you  know" do not, and never PASS "you know"', () => {
        expect(referenceCount("Y'know, that gives us time.", 'you_know')).toBe(1);
        for (const spelled of ['y know', 'y-know', 'you  know']) {
            const t = `${spelled} that gives us time.`;
            expect(referenceCount(t, 'you_know')).toBe(0);
            const aligned = alignFillers(t, [{ word: 'you know', anchor: 'that gives' }]);
            expect(aligned.instances[0].class).toBe('OMITTED');
            expect(corpusWordVerdict('you know', 1, t, aligned, 'synthetic').verdict).not.toBe('PASS');
        }
        const declared = "Y'know, that gives us time.";
        expect(corpusWordVerdict('you know', 1, declared, alignFillers(declared, [{ word: 'you know', anchor: 'that gives' }]), 'synthetic').verdict)
            .toBe('PASS');
    });

    it('m. verdicts cover the full key union: an unanchored "Ah." FAILs even though the corpus has no "ah" key', () => {
        const exact = corpusVerdicts(CORPUS, SCRIPT, alignFillers(SCRIPT, ANNOTATIONS), 'synthetic');
        expect(Object.keys(exact).sort()).toEqual(['ah', 'uh', 'um', 'you know']);
        expect(Object.values(exact).every((v) => v.verdict === 'PASS')).toBe(true);
        const t = `${SCRIPT} Ah.`;
        const withAh = corpusVerdicts(CORPUS, t, alignFillers(t, ANNOTATIONS), 'synthetic');
        expect(withAh.ah).toMatchObject({ verdict: 'FAIL', evidence: { expected: 0, inserted: 1 } });
        expect(withAh.um.verdict).toBe('PASS');
    });

    it('k. on human audio the same substitution is a FAIL, with no fixture leniency', () => {
        const t = SCRIPT.replace('Uh, I propose', 'Um, I propose');
        expect(verdict('um', t, 'human').verdict).toBe('FAIL');
    });
});

describe('APP-G1h counter independence: drift between product and reference is caught', () => {
    const variants = 'Umm, so. Uhm, right. Uhh, well. Er, then. Ahm, okay. Ahhh. You know, and y\'know, ya know. Um-hmm, um\'s um2 um_x.';

    it('the product counter and the reference agree on the script and on every declared variant', () => {
        for (const text of [SCRIPT, variants]) {
            const checked = crossCheckCounts(text, productFillerCount);
            expect(Object.values(checked).every((c) => c.verdict === 'PASS')).toBe(true);
        }
    });

    it('h. MUTANT: a product counter that stops counting "uhm" FAILs the cross-check', () => {
        const mutant = (text: string, key: string) => productFillerCount(text.replace(/\buhm\b/gi, ''), key);
        expect(crossCheckCounts(variants, mutant).um).toMatchObject({ verdict: 'FAIL', reference: 4, product: 3 });
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
