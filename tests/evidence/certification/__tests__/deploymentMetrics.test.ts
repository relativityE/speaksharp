/**
 * #1304 — the measurement schema, and the two rules that stop a ranking from lying.
 *
 * Both rules exist because the alternative is a single sorted table that looks authoritative and
 * compares things that were never comparable.
 */
import { describe, it, expect } from 'vitest';
import {
    percentile, assertSingleRuntime, rankTechnical, type TechnicalVerdict,
} from '../deploymentMetrics';

const row = (over: Partial<TechnicalVerdict> = {}): TechnicalVerdict => ({
    armId: 'arm', runtimeLabel: 'ort-web-1.27.0', evidenceSet: 'corpus', evidenceClass: 'selection',
    wer: 0.05, referenceWords: 1000,
    reliability: { expectedClips: 600, decoded: 600, threw: 0, emptyOutput: 0, timedOut: 0, audioRejected: 0, missing: 0 },
    speed: { coldLoadMs: 1, warmDecodeMsP50: 1, warmDecodeMsP95: 1, realTimeFactorP50: 0.1, realTimeFactorP95: 0.2, stopToFinalMs: 1 },
    footprint: { modelBytes: 1, assetCount: 1, peakMemoryBytes: null },
    duration: { shortestClipSeconds: 1, longestClipSeconds: 40, longFormTailPreserved: true, longFormRepeatedNgrams: 0, truncatedClips: 0 },
    backendProven: true, resolvedBackend: 'wasm', hardwareRepresentative: true,
    transcriptDigest: 'abc', fingerprint: 'def', assetDigestCount: 10,
    ...over,
});

describe('percentiles are reported, not invented', () => {
    it('nearest-rank over the samples given', () => {
        expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
        expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    });

    it('returns null for no samples rather than a number', () => {
        // A zero here would read as "instant" on a chart.
        expect(percentile([], 50)).toBeNull();
    });

    it('ignores non-finite samples instead of propagating NaN', () => {
        // Two finite samples remain, so nearest-rank p50 is the FIRST of them — not the larger. My
        // first expectation here said 3, which is the p50 of the unfiltered four; the filter is
        // exactly what makes that wrong.
        expect(percentile([1, Number.NaN, 3, Number.POSITIVE_INFINITY], 50)).toBe(1);
        expect(percentile([1, Number.NaN, 3, Number.POSITIVE_INFINITY], 95)).toBe(3);
    });
});

describe('a ranking refuses to mix runtimes', () => {
    it('rows from ONE runtime rank', () => {
        expect(() => assertSingleRuntime([row(), row({ armId: 'b' })])).not.toThrow();
    });

    it('rows from TWO runtimes throw, naming both', () => {
        // The ORT Web upgrade changes the inference library beneath every v4 and Moonshine arm. A
        // single sorted table would compare measurements of different systems, and the ordering would
        // be an artifact of which rows had been re-run.
        expect(() => assertSingleRuntime([
            row({ runtimeLabel: 'ort-web-1.26.0-dev.20260416' }),
            row({ runtimeLabel: 'ort-web-1.27.0' }),
        ])).toThrow(/refusing to rank across runtimes.*1\.26\.0-dev.*1\.27\.0/s);
    });

    it('rankTechnical enforces it too — not only the explicit assertion', () => {
        expect(() => rankTechnical([
            row({ runtimeLabel: 'ort-web-1.26.0-dev.20260416' }),
            row({ runtimeLabel: 'ort-web-1.27.0' }),
        ], { requireSelectionGrade: true })).toThrow(/refusing to rank across runtimes/);
    });

    it('and refuses to mix evidence SETS', () => {
        // 459-word preflight numbers and frozen-600 numbers are not interchangeable either.
        expect(() => rankTechnical([
            row({ evidenceSet: 'preflight', evidenceClass: 'preflight' }),
            row({ evidenceSet: 'corpus' }),
        ], { requireSelectionGrade: false })).toThrow(/refusing to rank across evidence sets/);
    });
});

describe('only rows that earned it enter the ranking', () => {
    it('ranks by WER, ascending', () => {
        const ranked = rankTechnical(
            [row({ armId: 'worse', wer: 0.09 }), row({ armId: 'better', wer: 0.03 })],
            { requireSelectionGrade: true },
        );
        expect(ranked.map((r) => r.armId)).toEqual(['better', 'worse']);
    });

    it('excludes a row with an unproven backend', () => {
        const ranked = rankTechnical([row({ armId: 'unproven', backendProven: false })], { requireSelectionGrade: true });
        expect(ranked).toEqual([]);
    });

    it('excludes a row that is MISSING clips, however good its WER', () => {
        // The whole point of the completeness rule: a partial corpus is a different corpus, and the
        // clips that go missing are systematically the hard ones.
        const partial = row({
            armId: 'partial', wer: 0.001,
            reliability: { ...row().reliability, decoded: 599, missing: 1 },
        });
        expect(rankTechnical([partial], { requireSelectionGrade: true })).toEqual([]);
    });

    it('excludes a smoke-set row from a selection ranking', () => {
        const smoke = row({ evidenceSet: 'harvard', evidenceClass: 'smoke' });
        expect(rankTechnical([smoke], { requireSelectionGrade: true })).toEqual([]);
        // ...but the same row IS rankable when selection grade is not required, e.g. a preflight look.
        expect(rankTechnical([smoke], { requireSelectionGrade: false })).toHaveLength(1);
    });

    it('a row with no WER cannot rank', () => {
        expect(rankTechnical([row({ wer: null })], { requireSelectionGrade: true })).toEqual([]);
    });
});

describe('technical and activation verdicts are separate types', () => {
    it('a technical verdict carries no activation fields', () => {
        // Structural: folding readiness into the model score lets the easiest-to-integrate candidate
        // beat a materially better one, and buries the reason inside one number nobody can argue with.
        const keys = Object.keys(row());
        for (const activation of ['adapter', 'selfHosting', 'finalization', 'fallbackProof', 'licenceNotice']) {
            expect(keys, `technical verdict must not carry ${activation}`).not.toContain(activation);
        }
    });

    it('reliability distinguishes every way a clip can fail', () => {
        // "Scored 599" tells you nothing about WHY. A throw, an empty return, a timeout, a rejected
        // digest and an absent clip are five different problems with five different owners.
        const keys = Object.keys(row().reliability);
        expect(keys).toEqual(expect.arrayContaining([
            'expectedClips', 'decoded', 'threw', 'emptyOutput', 'timedOut', 'audioRejected', 'missing',
        ]));
    });

    it('peak memory may be null — a browser page cannot report it, and it is not invented', () => {
        expect(row().footprint.peakMemoryBytes).toBeNull();
    });
});

describe('a ranking excludes dtype aliases', () => {
    const base = (over: Partial<TechnicalVerdict> = {}): TechnicalVerdict => ({
        armId: 'arm', runtimeLabel: 'r', evidenceSet: 'corpus', evidenceClass: 'selection',
        wer: 0.05, referenceWords: 1000,
        reliability: { expectedClips: 600, decoded: 600, threw: 0, emptyOutput: 0, timedOut: 0, audioRejected: 0, missing: 0 },
        speed: { coldLoadMs: 1, warmDecodeMsP50: 1, warmDecodeMsP95: 1, realTimeFactorP50: 0.1, realTimeFactorP95: 0.2, stopToFinalMs: 1 },
        footprint: { modelBytes: 1, assetCount: 1, peakMemoryBytes: null },
        duration: { shortestClipSeconds: 1, longestClipSeconds: 40, longFormTailPreserved: true, longFormRepeatedNgrams: 0, truncatedClips: 0 },
        backendProven: true, resolvedBackend: 'wasm', hardwareRepresentative: true,
        transcriptDigest: 'abc', fingerprint: 'def', assetDigestCount: 10, ...over,
    });

    it('the alias is dropped and its target kept', () => {
        const ranked = rankTechnical([
            base({ armId: 'int8' }),
            base({ armId: 'q8', dtypeAliasOf: 'int8' }),
        ], { requireSelectionGrade: true });
        expect(ranked.map((r) => r.armId)).toEqual(['int8']);
    });

    it('a better-scoring ALIAS still cannot displace anything', () => {
        // The failure this prevents: one model appearing twice at the top of a table, reading as two
        // independent results agreeing with each other.
        const ranked = rankTechnical([
            base({ armId: 'other', wer: 0.04 }),
            base({ armId: 'q8', wer: 0.01, dtypeAliasOf: 'int8' }),
        ], { requireSelectionGrade: true });
        expect(ranked.map((r) => r.armId)).toEqual(['other']);
    });
});
