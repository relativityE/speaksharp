/**
 * #1304 Task 3C — the certified harness, proven by running it.
 *
 * The contract these cover: route parity at short/boundary/long, all 68 official vectors through the
 * harness's own scoring path, a deterministic end-to-end proof that audio becomes a pooled WER, full
 * provenance, corpus completeness, and no selection row from missing or mismatched evidence.
 *
 * The end-to-end proof uses an INJECTED engine with hand-computed expected arithmetic. A real model
 * cannot prove the pipeline: its output is unknown in advance, so a wrong S/D/I calculation would
 * simply produce a different plausible number and nobody could tell. With an injected engine the
 * pooled result is known before the code runs.
 */
import { describe, it, expect } from 'vitest';
import goldens from '../../normalization/goldens.json';
import { CERTIFICATION_RULES } from '../rules';
import { runOracleVectorGate, scoringTokens, scoreUtterance, aggregateArm } from '../scoringAdapter';
import { checkRouteParity, PARITY_PROBE_SECONDS } from '../routeParity';
import { checkProvenance } from '../provenance';
import { certifyArm } from '../certify';
import { runArm, type CorpusUtterance } from '../runArm';
import type { ArmProvenance, DecodeArm } from '../engineArm';
import {
    resolveDecodeRoute,
    routeHash,
    DECODE_WINDOW_SECONDS,
} from '../../../../frontend/src/services/transcription/decodeRoute';

const ORACLE_VECTORS = (goldens as unknown as { cases: { category: string; input: string; expected: string }[] }).cases;
const MODEL_ID = 'Xenova/whisper-base.en';

const provenanceOf = (): ArmProvenance => ({
    model: { id: MODEL_ID, revision: 'abc123', filesSha256: { 'model.onnx': 'a'.repeat(64) } },
    runtime: { library: '@xenova/transformers', version: '2.17.2', backend: 'wasm' },
    assets: { source: 'self-hosted /models/', verdict: 'identical' },
    device: { platform: 'darwin', arch: 'arm64', cpuModel: 'Apple M-series', cores: 10 },
    route: { hash: routeHash(resolveDecodeRoute('v2', MODEL_ID, 4.2)), route: resolveDecodeRoute('v2', MODEL_ID, 4.2) },
    corpus: { version: 'librispeech_test_v1', archives: { 'test-clean.tar.gz': 'b'.repeat(64) } },
    resources: { wallClockMs: 1234, peakRssBytes: 2_000_000 },
});

/** An arm that decodes from a fixed lookup — deterministic, so the expected arithmetic is knowable. */
const makeArm = (transcripts: Record<string, string | null>, overrides: Partial<DecodeArm> = {}): DecodeArm => ({
    id: 'injected-arm',
    declareRoute: (seconds) => resolveDecodeRoute('v2', MODEL_ID, seconds),
    decode: async (_audio, seconds) => transcripts[String(seconds)] ?? null,
    provenance: provenanceOf,
    ...overrides,
});

const utterance = (id: string, reference: string, audioSeconds: number): CorpusUtterance => ({
    id, reference, audioSeconds, audio: new Float32Array(Math.round(audioSeconds * 16000)),
});

describe('the certification rules are immutable', () => {
    it('cannot be mutated at runtime', () => {
        // A gate a caller can rewrite is a gate a caller can pass. `Object.freeze` makes the attempt
        // fail rather than silently succeed under a different rule.
        expect(Object.isFrozen(CERTIFICATION_RULES)).toBe(true);
        expect(() => {
            (CERTIFICATION_RULES as unknown as { requiredOracleVectors: number }).requiredOracleVectors = 1;
        }).toThrow();
        expect(CERTIFICATION_RULES.requiredOracleVectors).toBe(68);
    });

    it('pins pooled Track-A scoring, not a mean and not a target', () => {
        expect(CERTIFICATION_RULES.aggregation).toBe('pooled');
        expect(CERTIFICATION_RULES.track).toBe('track_a');
        // Deliberately absent: there is no threshold, tolerance or target on this object. `0.0936` was
        // retired because it was a mean over surviving rows from a disqualified scorer on another path.
        expect(Object.keys(CERTIFICATION_RULES)).not.toContain('targetWer');
    });
});

describe('GATE — every official vector through the harness scoring path', () => {
    it('all 68 pass, with exactly one enumerated non-idempotent input', () => {
        const result = runOracleVectorGate(ORACLE_VECTORS);
        expect(result.failures).toEqual([]);
        expect(result.vectorsRun).toBe(68);
        expect(result.nonIdempotentInputs).toEqual(['...']);
        expect(result.ok).toBe(true);
    });

    it('a SHRUNKEN vector set fails — "all 68" must not become "all of whatever is left"', () => {
        const result = runOracleVectorGate(ORACLE_VECTORS.slice(0, 40));
        expect(result.failures).toEqual([]);
        expect(result.ok, 'a subset must not certify').toBe(false);
    });

    it('a vector the adapter normalizes differently is caught', () => {
        // Positive control for the gate itself: without this, a gate that never fails would pass every
        // other assertion here.
        const result = runOracleVectorGate([
            ...ORACLE_VECTORS,
            { category: 'planted', input: 'the quick brown fox', expected: 'a completely different sentence' },
        ]);
        expect(result.ok).toBe(false);
        expect(result.failures[0].invalidReason).toBe('normalization_differs_from_oracle');
    });

    it('a NEW non-idempotent input fails rather than joining the exemption', () => {
        // The exemption is an enumerated list precisely so it cannot grow silently.
        expect(CERTIFICATION_RULES.nonIdempotentOracleInputs).toEqual(['...']);
    });

    it('the tokens the gate checks are the tokens the scorer counts', () => {
        // Guards against the gate and the scorer drifting into two code paths: if they did, the gate
        // would be certifying a normalization the arithmetic never sees.
        const text = "Don't stop believin' — 42 times";
        const row = scoreUtterance('t', text, text);
        expect(row.ok && row.row.referenceWords).toBe(scoringTokens(text).length);
    });
});

describe('GATE — route parity with the shipping decode path', () => {
    it('probes short, the exact window boundary, and long', () => {
        expect(PARITY_PROBE_SECONDS.short).toBeLessThan(DECODE_WINDOW_SECONDS);
        expect(PARITY_PROBE_SECONDS.boundary).toBe(DECODE_WINDOW_SECONDS);
        expect(PARITY_PROBE_SECONDS.long).toBeGreaterThan(DECODE_WINDOW_SECONDS);
    });

    it('the probes actually straddle the branch — otherwise all three prove one thing', () => {
        // If every probe landed on the same branch, parity would be checked three times over the same
        // configuration and the long-form path would go unverified while appearing covered.
        const strides = Object.values(PARITY_PROBE_SECONDS)
            .map((s) => resolveDecodeRoute('v2', MODEL_ID, s).stride_length_s);
        expect(new Set(strides).size).toBe(2);
    });

    it('an arm resolving from the shipping module passes', () => {
        const result = checkRouteParity(makeArm({}), 'v2', MODEL_ID);
        expect(result.ok).toBe(true);
        expect(result.probes.map((p) => p.probe)).toEqual(['short', 'boundary', 'long']);
    });

    it('an arm that forces a stride onto SHORT audio is refused', () => {
        // This is the disqualifying defect of `benchmark-whisper-ceiling.mts`, reproduced: a fixed
        // 5-second stride on clips far below the context window. It measures a configuration no user
        // runs, and it must not be certifiable.
        const arm = makeArm({}, {
            declareRoute: (seconds) => ({ ...resolveDecodeRoute('v2', MODEL_ID, seconds), stride_length_s: 5 }),
        });
        const result = checkRouteParity(arm, 'v2', MODEL_ID);
        expect(result.ok).toBe(false);
        expect(result.probes.find((p) => p.probe === 'short')?.matched).toBe(false);
    });

    it('an arm that omits timestamps is refused', () => {
        const arm = makeArm({}, {
            declareRoute: (seconds) => ({ ...resolveDecodeRoute('v2', MODEL_ID, seconds), return_timestamps: false }),
        });
        expect(checkRouteParity(arm, 'v2', MODEL_ID).ok).toBe(false);
    });

    it('an arm that agrees everywhere EXCEPT the boundary is refused', () => {
        // The boundary is where an off-by-one lives: the product uses `<`, so the window itself is
        // long-form. Short and long probes alone would both pass.
        const arm = makeArm({}, {
            declareRoute: (seconds) =>
                seconds === DECODE_WINDOW_SECONDS
                    ? { ...resolveDecodeRoute('v2', MODEL_ID, seconds), stride_length_s: 0 }
                    : resolveDecodeRoute('v2', MODEL_ID, seconds),
        });
        const result = checkRouteParity(arm, 'v2', MODEL_ID);
        expect(result.ok).toBe(false);
        expect(result.probes.filter((p) => !p.matched).map((p) => p.probe)).toEqual(['boundary']);
    });
});

describe('GATE — provenance completeness', () => {
    it('a complete record passes', () => {
        expect(checkProvenance(provenanceOf())).toMatchObject({ ok: true, missing: [], empty: [] });
    });

    it.each(CERTIFICATION_RULES.requiredProvenance)('a missing `%s` fails', (field) => {
        const provenance = { ...provenanceOf() } as unknown as Record<string, unknown>;
        delete provenance[field];
        const check = checkProvenance(provenance as unknown as ArmProvenance);
        expect(check.ok).toBe(false);
        expect(check.missing).toContain(field);
    });

    it('a whole field that is an EMPTY OBJECT fails', () => {
        // Distinct from a missing field and from a blank leaf: `device: {}` has the right shape and
        // tells you nothing. Without this the top-level emptiness branch is never exercised.
        const provenance = provenanceOf();
        (provenance as unknown as Record<string, unknown>).device = {};
        const check = checkProvenance(provenance);
        expect(check.ok).toBe(false);
        expect(check.empty).toContain('device');
    });

    it('a field that is PRESENT but empty fails too', () => {
        // An empty digest map is a promise of provenance, not provenance.
        const provenance = provenanceOf();
        provenance.model.filesSha256 = {};
        const check = checkProvenance(provenance);
        expect(check.ok).toBe(false);
        expect(check.empty).toContain('model.filesSha256');
    });

    it('a blank string inside a field fails', () => {
        const provenance = provenanceOf();
        provenance.model.id = '   ';
        expect(checkProvenance(provenance).empty).toContain('model.id');
    });

    it('absent provenance entirely fails, listing every field', () => {
        expect(checkProvenance(null).missing).toEqual([...CERTIFICATION_RULES.requiredProvenance]);
    });
});

/**
 * END TO END, with arithmetic known in advance.
 *
 * Three utterances, hand-computed:
 *   u1  ref 4 words, hyp identical                       -> 0 edits
 *   u2  ref 5 words, one substitution                    -> 1 edit
 *   u3  ref 3 words, one deletion + one insertion        -> 2 edits
 * Pooled = (0+1+2) / (4+5+3) = 3/12 = 0.25.
 * The MEAN of per-utterance WERs would be (0 + 0.2 + 0.667)/3 = 0.289 — a different number from the
 * same data, which is exactly why the aggregation rule is pinned rather than assumed.
 */
describe('END TO END — audio to a pooled WER, on an injected engine', () => {
    const UTTERANCES: CorpusUtterance[] = [
        utterance('u1', 'THE CAT SAT DOWN', 1),
        utterance('u2', 'A SMOOTH ROAD MAKES DRIVING', 2),
        utterance('u3', 'BIRDS FLY SOUTH', 3),
    ];
    const TRANSCRIPTS: Record<string, string> = {
        '1': 'the cat sat down',
        '2': 'a smooth road makes walking',
        '3': 'birds fly quickly and',
    };

    const certifyInjected = (arm: DecodeArm) => certifyArm(arm, 'v2', MODEL_ID, ORACLE_VECTORS);

    it('produces the hand-computed pooled WER, and the S/D/I that make it up', async () => {
        const arm = makeArm(TRANSCRIPTS);
        const result = await runArm(arm, certifyInjected(arm), UTTERANCES);
        expect(result.ok, `${result.ok ? '' : `${result.reason}: ${result.detail}`}`).toBe(true);
        if (!result.ok) return;

        expect(result.row.referenceWords).toBe(12);
        expect(result.row.substitutions + result.row.deletions + result.row.insertions).toBe(3);
        expect(result.row.wer).toBeCloseTo(0.25, 10);
        expect(result.row.aggregation).toBe('pooled');
        expect(result.row.track).toBe('track_a');
    });

    it('the pooled figure is NOT the mean of per-utterance WERs', async () => {
        // Same data, two statistics. Publishing one under the other's name is how a benchmark stops
        // being comparable with anything.
        const arm = makeArm(TRANSCRIPTS);
        const result = await runArm(arm, certifyInjected(arm), UTTERANCES);
        if (!result.ok) throw new Error(result.reason);
        const perUtterance = result.scores.map((s) => (s.ok ? s.row.wer ?? 0 : 0));
        const mean = perUtterance.reduce((a, b) => a + b, 0) / perUtterance.length;
        expect(mean).toBeCloseTo(0.2889, 3);
        expect(result.row.wer).not.toBeCloseTo(mean, 3);
    });

    it('an UNCERTIFIED arm produces no row at all', async () => {
        const arm = makeArm(TRANSCRIPTS, {
            declareRoute: (seconds) => ({ ...resolveDecodeRoute('v2', MODEL_ID, seconds), stride_length_s: 5 }),
        });
        const result = await runArm(arm, certifyInjected(arm), UTTERANCES);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('not_certified');
        expect(result.detail).toContain('route_parity');
    });

    it('a FAILED decode invalidates the arm instead of quietly improving it', async () => {
        // The retired harnesses caught the exception, skipped the clip, and divided by the survivors.
        // The clips that fail are systematically the hard ones, so skipping them raises the score.
        const arm = makeArm(TRANSCRIPTS, {
            decode: async (_audio, seconds) => {
                if (seconds === 3) throw new Error('decode exploded');
                return TRANSCRIPTS[String(seconds)];
            },
        });
        const result = await runArm(arm, certifyInjected(arm), UTTERANCES);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('unscoreable_arm');
        expect(result.aggregate?.wer).toBeNull();
        // EVERY expected utterance is scored, including the one that threw. A skip would drop it from
        // both numerator and denominator; this asserts the score exists and is named invalid, which is
        // the difference between "the arm is invalid" and "the arm looks better than it is".
        expect(result.scores).toHaveLength(3);
        expect(result.scores.filter((s) => s.ok)).toHaveLength(2);
        expect(result.scores.find((s) => s.utteranceId === 'u3')).toMatchObject({ ok: false });
        // And the crash is distinguishable from a model that simply returned nothing.
        expect(result.decodeFailures).toEqual([{ utteranceId: 'u3', message: 'decode exploded' }]);
    });

    it('an EMPTY decode is a named result, not a total miss and not a skip', async () => {
        const arm = makeArm({ ...TRANSCRIPTS, '2': '' });
        const result = await runArm(arm, certifyInjected(arm), UTTERANCES);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.scores.find((s) => s.utteranceId === 'u2')).toMatchObject({
            ok: false, invalidReason: 'empty_hypothesis',
        });
        // A silent model is NOT a crash: nothing threw, so nothing is reported as having thrown.
        expect(result.decodeFailures).toEqual([]);
    });

    it('a PARTIAL corpus produces no WER — a smaller corpus is a different corpus', async () => {
        const arm = makeArm(TRANSCRIPTS);
        const certification = certifyInjected(arm);
        // Two of the three run, but the manifest expects three.
        const result = await runArm(arm, certification, UTTERANCES.slice(0, 2));
        expect(result.ok).toBe(true);
        // ...and scoring those two against the FULL expected set is what must be refused.
        const scores = result.ok ? result.scores : [];
        expect(aggregateArm(scores, UTTERANCES.map((u) => u.id))).toMatchObject({
            wer: null, armInvalidReason: 'incomplete_corpus', missingUtteranceIds: ['u3'],
        });
    });

    it('provenance that goes missing between certification and emission still blocks the row', async () => {
        // Resource figures only exist after the run, so provenance is re-checked at emission rather
        // than trusted from certification time.
        let calls = 0;
        const arm = makeArm(TRANSCRIPTS, {
            provenance: () => {
                calls += 1;
                const p = provenanceOf();
                if (calls > 1) (p as unknown as Record<string, unknown>).resources = undefined;
                return p;
            },
        });
        const result = await runArm(arm, certifyInjected(arm), UTTERANCES);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('incomplete_provenance');
        expect(result.detail).toContain('resources');
    });

    it('the emitted row carries the rules version that certified it', async () => {
        const arm = makeArm(TRANSCRIPTS);
        const result = await runArm(arm, certifyInjected(arm), UTTERANCES);
        if (!result.ok) throw new Error(result.reason);
        expect(result.row.rulesVersion).toBe(CERTIFICATION_RULES.version);
        expect(result.row.armId).toBe('injected-arm');
    });
});
