/**
 * #1304 — the decision policy, tested on SYNTHETIC data before the frozen-600 results exist.
 *
 * That ordering is the point. Every threshold and tie rule here was fixed while nobody knew which
 * model would win, so no rule can be tuned to ratify a preferred answer. The inputs below are
 * constructed; not one comes from a real run.
 */
import { describe, it, expect } from 'vitest';
import {
    SELECTION_POLICY, qualify, pairedBootstrapInterval, select, decideActivation,
    type PairedUtterance,
} from '../selectionPolicy';
import { rankTechnical, type TechnicalVerdict } from '../deploymentMetrics';

const perfect = (over: Partial<TechnicalVerdict> = {}): TechnicalVerdict => ({
    armId: 'arm', runtimeLabel: 'rt', evidenceSet: 'corpus', evidenceClass: 'selection',
    wer: 0.05, referenceWords: 12000,
    reliability: { expectedClips: 600, decoded: 600, threw: 0, emptyOutput: 0, timedOut: 0, audioRejected: 0, missing: 0 },
    speed: { coldLoadMs: 1000, warmDecodeMsP50: 200, warmDecodeMsP95: 400, realTimeFactorP50: 0.1, realTimeFactorP95: 0.3, stopToFinalMs: 900 },
    footprint: { modelBytes: 100e6, assetCount: 7, peakMemoryBytes: null },
    duration: { shortestClipSeconds: 1.2, longestClipSeconds: 38, longFormTailPreserved: true, longFormRepeatedNgrams: 0, truncatedClips: 0 },
    backendProven: true, resolvedBackend: 'wasm', hardwareRepresentative: true,
    transcriptDigest: 'd', fingerprint: 'f', assetDigestCount: 7, ...over,
});

describe('the policy is frozen and states its own constants', () => {
    it('cannot be mutated at runtime', () => {
        expect(Object.isFrozen(SELECTION_POLICY)).toBe(true);
        expect(SELECTION_POLICY.requiredClips).toBe(600);
        expect(SELECTION_POLICY.maxRealTimeFactorP95).toBe(1.0);
        expect(SELECTION_POLICY.confidence).toBe(0.95);
    });
});

describe('rule 1 — reliability: exactly 600/600, every failure counter zero', () => {
    it('a perfect run qualifies', () => {
        expect(qualify(perfect())).toMatchObject({ qualified: true, reasons: [] });
    });

    it.each([
        ['threw', { threw: 1 }],
        ['emptyOutput', { emptyOutput: 1 }],
        ['timedOut', { timedOut: 1 }],
        ['audioRejected', { audioRejected: 1 }],
        ['missing', { missing: 1 }],
    ])('a single %s disqualifies, however good the WER', (_name, failure) => {
        // The clips that fail are systematically the hard ones, so tolerating one rewards the failure.
        const row = perfect({
            wer: 0.001,
            reliability: { ...perfect().reliability, decoded: 599, ...failure },
        });
        const result = qualify(row);
        expect(result.qualified).toBe(false);
        expect(result.reasons).toContain('reliability_failures');
    });

    it('599 of 600 disqualifies even with every counter zero', () => {
        const row = perfect({ reliability: { ...perfect().reliability, decoded: 599 } });
        expect(qualify(row).reasons).toContain('incomplete_corpus');
    });
});

describe('rule 4 — p95 RTF must be under 1.0, and NULL is not a pass', () => {
    it('0.99 passes, 1.0 does not', () => {
        expect(qualify(perfect({ speed: { ...perfect().speed, realTimeFactorP95: 0.99 } })).qualified).toBe(true);
        expect(qualify(perfect({ speed: { ...perfect().speed, realTimeFactorP95: 1.0 } })).reasons)
            .toContain('rtf_p95_too_slow');
    });

    it('an UNMEASURED latency cannot clear a latency gate', () => {
        expect(qualify(perfect({ speed: { ...perfect().speed, realTimeFactorP95: null } })).reasons)
            .toContain('rtf_p95_too_slow');
    });
});

describe('rule 5 — long-form integrity', () => {
    it.each([
        ['truncation', { truncatedClips: 1 }, 'long_form_truncated'],
        ['a lost tail', { longFormTailPreserved: false }, 'long_form_tail_lost'],
        ['a repeated loop', { longFormRepeatedNgrams: 2 }, 'long_form_looping'],
    ])('%s disqualifies', (_name, duration, reason) => {
        // These are exactly the failures a pooled WER over short clips averages away.
        expect(qualify(perfect({ duration: { ...perfect().duration, ...duration } })).reasons)
            .toContain(reason);
    });
});

describe('rules 9 and 10 — aliases and unproven backends', () => {
    it('an alias is visible but never qualifies', () => {
        expect(qualify(perfect({ dtypeAliasOf: 'other' })).reasons).toContain('dtype_alias');
    });

    it('an unproven backend disqualifies', () => {
        expect(qualify(perfect({ backendProven: false })).reasons).toContain('backend_not_proven');
    });

    it('a non-selection-grade set disqualifies', () => {
        expect(qualify(perfect({ evidenceClass: 'preflight' })).reasons).toContain('not_selection_grade');
    });
});

/** Utterances where arm A makes `errA` errors and B makes `errB`, over `n` clips of 20 words. */
const paired = (n: number, errA: number, errB: number): [PairedUtterance[], PairedUtterance[]] => [
    Array.from({ length: n }, (_, i) => ({ utteranceId: `u${i}`, referenceWords: 20, errors: errA })),
    Array.from({ length: n }, (_, i) => ({ utteranceId: `u${i}`, referenceWords: 20, errors: errB })),
];

describe('rules 2 and 3 — paired bootstrap, and a tie is a tie', () => {
    it('identical arms are TIED, and the interval spans zero', () => {
        const [a, b] = paired(600, 1, 1);
        const interval = pairedBootstrapInterval(a, b);
        expect(interval.observedDelta).toBe(0);
        expect(interval.tied).toBe(true);
        expect(interval.lower).toBeLessThanOrEqual(0);
        expect(interval.upper).toBeGreaterThanOrEqual(0);
    });

    it('a LARGE consistent difference is not a tie', () => {
        const [a, b] = paired(600, 1, 5);
        const interval = pairedBootstrapInterval(a, b);
        expect(interval.observedDelta).toBeLessThan(0); // A is better
        expect(interval.tied).toBe(false);
    });

    it('a TINY difference from a handful of clips IS a tie', () => {
        // The case the rule exists for: a 0.0003 gap on 600 clips is not a winner. Two arms identical
        // except on three clips, where A does slightly better.
        const [a, b] = paired(600, 1, 1);
        for (let i = 0; i < 3; i++) b[i].errors = 2;
        const interval = pairedBootstrapInterval(a, b);
        expect(Math.abs(interval.observedDelta)).toBeLessThan(0.001);
        expect(interval.tied).toBe(true);
    });

    it('is DETERMINISTIC — the same inputs give the same interval', () => {
        // The interval must be reproducible from committed per-utterance scores, on any machine,
        // without decoding 600 clips again.
        const [a, b] = paired(300, 1, 2);
        const first = pairedBootstrapInterval(a, b);
        const second = pairedBootstrapInterval(a, b);
        expect(second).toEqual(first);
    });

    it('is PAIRED — it uses shared utterances, and refuses when there are none', () => {
        const [a] = paired(10, 1, 1);
        const disjoint: PairedUtterance[] = [{ utteranceId: 'other', referenceWords: 20, errors: 1 }];
        expect(() => pairedBootstrapInterval(a, disjoint)).toThrow(/share utterances/);
    });

    it('the sign convention is A minus B: negative means A is better', () => {
        const [a, b] = paired(100, 1, 3);
        expect(pairedBootstrapInterval(a, b).observedDelta).toBeLessThan(0);
        expect(pairedBootstrapInterval(b, a).observedDelta).toBeGreaterThan(0);
    });
});

describe('rules 6 and 7 — primary is best, fallback fails DIFFERENTLY', () => {
    const exposure = new Map([
        ['fast-a', { runtime: 'transformers-js', family: 'whisper' }],
        ['fast-b', { runtime: 'transformers-js', family: 'whisper' }],
        ['other',  { runtime: 'moonshine-wasm', family: 'moonshine' }],
    ]);
    const rows = [
        perfect({ armId: 'fast-a', wer: 0.030 }),
        perfect({ armId: 'fast-b', wer: 0.031 }),
        perfect({ armId: 'other',  wer: 0.045 }),
    ];
    const scores = new Map([
        ['fast-a', paired(600, 1, 1)[0]],
        ['fast-b', paired(600, 1, 1)[0]],
        ['other',  paired(600, 2, 2)[0]],
    ]);

    it('the primary is the best qualified model, with no integration adjustment', () => {
        expect(select(rows, scores, (id) => exposure.get(id)!).primary).toBe('fast-a');
    });

    it('the fallback is NOT second place when second place fails the same way', () => {
        // `fast-b` scores better than `other`, but shares the primary's runtime AND family — they fail
        // together, which is the one thing a fallback exists not to do.
        const result = select(rows, scores, (id) => exposure.get(id)!);
        expect(result.fallback).toBe('other');
        expect(result.fallback).not.toBe('fast-b');
        expect(result.fallbackRationale).toMatch(/different failure exposure/);
    });

    it('says so plainly when no candidate has different exposure', () => {
        const sameOnly = rows.slice(0, 2);
        const result = select(sameOnly, scores, (id) => exposure.get(id)!);
        expect(result.fallback).toBeNull();
        expect(result.fallbackRationale).toMatch(/no qualified candidate/);
    });

    it('records who is statistically TIED with the primary', () => {
        // So a coin-flip between indistinguishable models is not read as a verdict.
        const result = select(rows, scores, (id) => exposure.get(id)!);
        expect(result.tiedWithPrimary).toContain('fast-b');
    });

    it('a disqualified model cannot be primary however good its WER', () => {
        const withCheat = [perfect({ armId: 'cheat', wer: 0.001, reliability: { ...perfect().reliability, missing: 1 } }), ...rows];
        const result = select(withCheat, scores, (id) => exposure.get(id) ?? { runtime: 'x', family: 'y' });
        expect(result.primary).toBe('fast-a');
        expect(result.disqualified.map((d) => d.armId)).toContain('cheat');
    });
});

describe('rule 8 — activation never rewrites who technically won', () => {
    const ready = (ids: string[], blocked: Record<string, string[]> = {}) =>
        new Map(Object.entries({
            ...Object.fromEntries(ids.map((id) => [id, { ready: true, blockers: [] as string[] }])),
            ...Object.fromEntries(Object.entries(blocked).map(([id, b]) => [id, { ready: false, blockers: b }])),
        }));

    it('a ready technical winner is activated', () => {
        const d = decideActivation('best', ready(['best', 'second']), ['best', 'second']);
        expect(d).toMatchObject({ technicalWinner: 'best', activated: 'best', divergenceReason: null });
    });

    it('an unshippable winner STILL WON — something else is merely activated', () => {
        const d = decideActivation('best', ready(['second'], { best: ['no adapter', 'assets unpinned'] }), ['best', 'second']);
        expect(d.technicalWinner).toBe('best');
        expect(d.activated).toBe('second');
        expect(d.divergenceReason).toMatch(/does NOT change who technically won/);
        expect(d.divergenceReason).toMatch(/no adapter/);
    });

    it('names the situation when nothing qualified is ready', () => {
        const d = decideActivation('best', ready([], { best: ['blocked'] }), ['best']);
        expect(d.activated).toBeNull();
        expect(d.divergenceReason).toMatch(/no qualified candidate is ready/);
    });
});

/**
 * #1304 — the runner iterates the WHOLE matrix, so two measured arms must never rank.
 *
 * "Every distinct candidate" was my phrasing and it was wrong: the runner walks `ARM_MATRIX`, which
 * measures 14 admitted arms while only 13 are distinct candidates. The two extras are the q8 alias of
 * int8 and the q4 CPU diagnostic, which collapses onto the WASM cell in a browser.
 *
 * The alias was already excluded. The DIAGNOSTIC was not — a row that qualified on every other axis
 * could have entered the ranking as a second copy of an arm already in it.
 */
describe('measured arms that must never rank', () => {
    it('a DIAGNOSTIC row is disqualified, however good its numbers', () => {
        const result = qualify(perfect({ armId: 'v4:base:q4-decoder:cpu', role: 'diagnostic', wer: 0.001 }));
        expect(result.qualified).toBe(false);
        expect(result.reasons).toContain('diagnostic_row');
    });

    it('a selection row with the same numbers DOES qualify — the role is what differs', () => {
        // Positive control: without it, a `qualify` that rejected everything would pass the above.
        expect(qualify(perfect({ role: 'selection' })).qualified).toBe(true);
    });

    it('both extras are excluded from a ranking, and the rest survive', () => {
        const rows = [
            perfect({ armId: 'real-a', wer: 0.040, role: 'selection' }),
            perfect({ armId: 'v4:base:q4-decoder:cpu', wer: 0.001, role: 'diagnostic' }),
            perfect({ armId: 'v4:base:q8-decoder:cpu', wer: 0.002, dtypeAliasOf: 'v4:base:int8-decoder:cpu' }),
            perfect({ armId: 'real-b', wer: 0.050, role: 'selection' }),
        ];
        const ranked = rankTechnical(rows, { requireSelectionGrade: true });
        // Both would have taken the top two places on WER alone.
        expect(ranked.map((r) => r.armId)).toEqual(['real-a', 'real-b']);
    });

    it('a row with no role recorded still ranks — absence is not a diagnostic claim', () => {
        // Rows predating the field must not be silently dropped from a ranking.
        expect(rankTechnical([perfect({ armId: 'legacy' })], { requireSelectionGrade: true }))
            .toHaveLength(1);
    });
});
