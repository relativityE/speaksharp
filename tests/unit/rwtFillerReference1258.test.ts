// @vitest-environment node
/**
 * APP-G1h (Sam 1792982426.848739): the independent filler reference behind the Open Mic `filler "<word>" vs corpus` rows.
 * L1 (run 40071973428 on fb30674e) failed `filler "um" vs corpus` with corpus 4 vs transcript 5 while transcript, display and
 * saved agreed. These controls prove the reference still catches omissions, insertions and counter drift, and (PO
 * 2026-11-11: no exemptions for um, uh or ah) that a substitution FAILs on synthetic audio too, while a missing, repeated or
 * contested anchor still HOLDs. All inputs are built from the TTS script.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { productFillerCount } from '../live/helpers/rwtFillerOracle';
import {
    OPEN_MIC_TTS_ANNOTATIONS, OPEN_MIC_TTS_IDENTITY,
    alignFillers, corpusRows, corpusVerdicts, corpusWordVerdict, crossCheckCounts, fillerAnnotationsOf, hesitationTotals, integrityVerdict,
    referenceCount, type FillerAnnotation,
} from '../live/helpers/rwtFillerReference';

const FIXTURES = path.join(__dirname, '../fixtures/rwt');
const MANIFEST = JSON.parse(readFileSync(path.join(FIXTURES, 'rwt-fixtures.manifest.json'), 'utf8')) as {
    fixtures: Record<string, { file: string; sha256: string; kind: string; groundTruthFillers: Record<string, number> }>;
};
const ENTRY = MANIFEST.fixtures.open_mic_tts;
const CORPUS = ENTRY.groundTruthFillers;
const ANNOTATIONS: FillerAnnotation[] = fillerAnnotationsOf(ENTRY);
const SCRIPT = /^OPEN_MIC="(.*)"$/m.exec(readFileSync(path.join(FIXTURES, 'generate-rwt-tts-fixtures.sh'), 'utf8'))![1];

const verdict = (word: string, transcript: string, kind: 'synthetic' | 'human' = 'synthetic') =>
    corpusWordVerdict(word, CORPUS[word], transcript, alignFillers(transcript, ANNOTATIONS), kind);

describe('#1720 annotations live in reviewed code, bound to the canonical fixture identity (Sam 1793018351.121669)', () => {
    it('the manifest inventory carries no annotations; the canonical synthetic entry gets exactly the eight in code', () => {
        expect(Object.prototype.hasOwnProperty.call(ENTRY, 'fillerAnnotations')).toBe(false);
        expect(ENTRY).toMatchObject(OPEN_MIC_TTS_IDENTITY);
        expect(fillerAnnotationsOf(ENTRY)).toEqual([...OPEN_MIC_TTS_ANNOTATIONS]);
        expect(OPEN_MIC_TTS_ANNOTATIONS).toHaveLength(8);
    });

    it('a human recording built from the same entry inherits no synthetic annotations', () => {
        expect(fillerAnnotationsOf({ ...ENTRY, kind: 'human', knownFixtureLimits: [] })).toEqual([]);
    });

    it('any other identity — another sha256, another file, another or unknown fixture — gets none', () => {
        expect(fillerAnnotationsOf({ ...ENTRY, sha256: '0'.repeat(64) })).toEqual([]);
        expect(fillerAnnotationsOf({ ...ENTRY, file: 'focus_points_tts.wav' })).toEqual([]);
        const others = Object.entries(MANIFEST.fixtures).filter(([key]) => key !== 'open_mic_tts');
        expect(others.length).toBeGreaterThan(0);
        expect(others.map(([key, entry]) => ({ key, annotations: fillerAnnotationsOf(entry) })))
            .toEqual(others.map(([key]) => ({ key, annotations: [] })));
        for (const odd of [null, undefined, {}, 'open_mic_tts', { fillerAnnotations: { items: [{ word: 'um', anchor: 'x' }] } }]) {
            expect(fillerAnnotationsOf(odd)).toEqual([]);
        }
    });

    it('callers get copies: mutating a result cannot change the reviewed table', () => {
        // A private clone, so a shared-reference defect fails only this test instead of corrupting ENTRY for the others.
        const entry = structuredClone(ENTRY);
        const first = fillerAnnotationsOf(entry);
        first[0].word = 'uh';
        first.pop();
        expect(fillerAnnotationsOf(entry)).toEqual([...OPEN_MIC_TTS_ANNOTATIONS]);
        expect(Object.isFrozen(OPEN_MIC_TTS_ANNOTATIONS) && Object.isFrozen(OPEN_MIC_TTS_ANNOTATIONS[0])).toBe(true);
    });
});

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

describe('APP-G1h corpus verdicts: exact per word, substitutions FAIL (PO 2026-11-11)', () => {
    it('a. the exact script passes every corpus word', () => {
        for (const word of Object.keys(CORPUS)) expect(verdict(word, SCRIPT).verdict).toBe('PASS');
    });

    it('b. one scripted "uh" recognised as "um" FAILs both words on synthetic audio (a real substitution, no exemption)', () => {
        const t = SCRIPT.replace('Uh, I propose', 'Um, I propose');
        expect(verdict('um', t)).toMatchObject({ verdict: 'FAIL', detail: 'a scripted hesitation was recognised as another', evidence: { transcript: 5, substitutedIn: 1 } });
        expect(verdict('uh', t)).toMatchObject({ verdict: 'FAIL', evidence: { substitutedOut: 1 } });
    });

    it('the run 43065574631 / L1 shape (um 5, ah 2, uh 0; total conserved) FAILs um, uh and ah: a correct total is not correct classification', () => {
        const t = SCRIPT.replace('Uh, I propose', 'Um, I propose').replace('Uh, every Friday', 'Ah, every Friday')
            .replace('Uh, I will share', 'Ah, I will share');
        expect([referenceCount(t, 'um'), referenceCount(t, 'uh'), referenceCount(t, 'ah')]).toEqual([5, 0, 2]);
        expect(verdict('um', t)).toMatchObject({ verdict: 'FAIL', evidence: { expected: 4, transcript: 5, matched: 4, substitutedIn: 1, omitted: 0, inserted: 0, held: 0 } });
        expect(verdict('uh', t)).toMatchObject({ verdict: 'FAIL', evidence: { expected: 3, transcript: 0, substitutedOut: 3 } });
        expect(corpusWordVerdict('ah', 0, t, alignFillers(t, ANNOTATIONS), 'synthetic')).toMatchObject({ verdict: 'FAIL', evidence: { expected: 0, transcript: 2, substitutedIn: 2 } });
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

describe('APP-G1h spec rows (PO 2026-11-11): every word gets a row, "uh" included; no suppression, no exemption', () => {
    const rowsOf = (t: string, kind: 'synthetic' | 'human' = 'synthetic') =>
        Object.fromEntries(corpusRows(CORPUS, t, ANNOTATIONS, kind).map((r) => [r.word, r]));

    it('p. a displaced "uh" (omitted before "every Friday", inserted elsewhere) FAILs although every count is equal', () => {
        const t = `${SCRIPT.replace('Uh, every Friday', 'Every Friday')} Uh.`;
        expect(t).not.toBe(`${SCRIPT} Uh.`);
        expect(hesitationTotals(t, CORPUS)).toEqual({ expected: 7, transcript: 7 });
        expect(Object.values(crossCheckCounts(t, productFillerCount)).every((c) => c.verdict === 'PASS')).toBe(true);
        const rows = rowsOf(t);
        expect(rows.uh).toMatchObject({ verdict: 'FAIL', evidence: { expected: 3, transcript: 3, omitted: 1, inserted: 1 } });
        for (const word of ['um', 'you know', 'ah']) expect(rows[word].verdict).toBe('PASS');
    });

    it('q. CONTROL (unchanged per-word counts): the exact script emits all four rows, "uh" included, and every one PASSes', () => {
        const rows = rowsOf(SCRIPT);
        expect(Object.keys(rows).sort()).toEqual(['ah', 'uh', 'um', 'you know']);
        expect(Object.values(rows).every((r) => r.verdict === 'PASS')).toBe(true);
        expect(rows.uh).toMatchObject({ evidence: { expected: 3, transcript: 3, matched: 3 } });
        expect(rowsOf(SCRIPT, 'human').uh.verdict).toBe('PASS');
    });

    it('q2. the run 43065574631 shape emits a visible "uh" row (expected 3, got 0) and FAILs um, uh and ah; "you know" still PASSes', () => {
        const l1 = SCRIPT.replace('Uh, I propose', 'Um, I propose').replace('Uh, every Friday', 'Ah, every Friday')
            .replace('Uh, I will share', 'Ah, I will share');
        const rows = rowsOf(l1);
        expect(rows.uh).toMatchObject({ verdict: 'FAIL', evidence: { expected: 3, transcript: 0, substitutedOut: 3 } });
        expect([rows.um.verdict, rows.ah.verdict, rows['you know'].verdict]).toEqual(['FAIL', 'FAIL', 'PASS']);
        for (const r of Object.values(rows)) expect(r.detail).not.toMatch(/fixture-limited|unverified/i);
    });

    it('q3. uncertainty stays HOLD, never an invented FAIL or PASS: a garbled "uh" anchor HOLDs the "uh" row', () => {
        const rows = rowsOf(SCRIPT.replace('every Friday', 'every fry day'));
        expect(rows.uh.verdict).toBe('HOLD');
        expect(rows.um.verdict).toBe('PASS');
    });

    it('q4. a dropped sentence-initial "uh" (omitted, nothing in its place) FAILs the "uh" row', () => {
        expect(rowsOf(SCRIPT.replace('Uh, I propose', 'I propose')).uh).toMatchObject({ verdict: 'FAIL', evidence: { omitted: 1 } });
    });

    it('r. the Open Mic spec emits exactly these rows and keeps its human "uh" observation', () => {
        const spec = readFileSync(path.join(__dirname, '../live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
        expect(spec).toMatch(/for \(const row of corpusRows\(corpus, transcript, fillerAnnotationsOf\(fixture\.entry\), fixture\.entry\.kind\)\)/);
        expect(spec).toMatch(/receipt\.row\(`filler "\$\{row\.word\}" vs corpus`, row\.verdict, row\.detail,/);
        expect(spec).toMatch(/humanObservation\(receipt, 'open_mic_uh_detected'/);
        expect(spec).not.toMatch(/corpusVerdicts\(/);
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

describe('#1720 review P2 (r4377679000): the human recording keeps an exact count comparison without annotations', () => {
    const HUMAN = fillerAnnotationsOf({ ...ENTRY, kind: 'human', knownFixtureLimits: [] });
    const rows = (transcript: string, kind: 'synthetic' | 'human') => Object.fromEntries(
        corpusRows(CORPUS, transcript, kind === 'human' ? HUMAN : [], kind).map((r) => [r.word, r.verdict]));

    it('the human entry still inherits no synthetic annotations', () => {
        expect(HUMAN).toEqual([]);
    });

    it('a human transcript with every scripted filler PASSes each corpus word', () => {
        const verdicts = rows(SCRIPT, 'human');
        for (const word of Object.keys(CORPUS)) expect({ word, verdict: verdicts[word] }).toEqual({ word, verdict: 'PASS' });
    });

    it('a human transcript that drops a spoken "uh" or inserts an "um" FAILs that word', () => {
        expect(rows(SCRIPT.replace('Uh, I propose', 'I propose'), 'human').uh).toBe('FAIL');
        expect(rows(SCRIPT.replace('I will share', 'um, I will share'), 'human').um).toBe('FAIL');
    });

    it('a missing, malformed or empty corpus never becomes a zero-count PASS', () => {
        expect(corpusRows({}, SCRIPT, HUMAN, 'human')).toEqual([expect.objectContaining({ verdict: 'HOLD' })]);
        const malformed = Object.fromEntries(corpusRows({ ...CORPUS, um: Number.NaN, uh: -1, 'you know': 1.5 } as never, SCRIPT, HUMAN, 'human').map((r) => [r.word, r.verdict]));
        expect([malformed.um, malformed.uh, malformed['you know']]).toEqual(['HOLD', 'HOLD', 'HOLD']);
    });

    it('a reference filler the corpus does not declare FAILs when spoken and emits no row when silent', () => {
        expect(rows(SCRIPT, 'human').ah).toBeUndefined();
        expect(rows(SCRIPT.replace('I will share', 'ah, I will share'), 'human').ah).toBe('FAIL');
    });

    it('CONTROL (missing evidence): a synthetic fixture without annotations HOLDs every word, "uh" included (no count-based PASS)', () => {
        const verdicts = rows(SCRIPT, 'synthetic');
        expect(Object.values(verdicts).every((v) => v === 'HOLD')).toBe(true);
        expect(Object.keys(verdicts).sort()).toEqual(['ah', 'uh', 'um', 'you know']);
    });
});
