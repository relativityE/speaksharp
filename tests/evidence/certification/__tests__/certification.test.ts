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
import { runOracleVectorGate, scoringTokens, scoreUtterance } from '../scoringAdapter';
import { checkRouteParity, PARITY_PROBE_SECONDS } from '../routeParity';
import { checkProvenance } from '../provenance';
import { certifyArm } from '../certify';
import { runArm, type CorpusUtterance } from '../runArm';
import type { ArmProvenance, DecodeArm } from '../engineArm';
import {
    resolveWhisperRoute,
    resolveMoonshineRoute,
    candidateRouteHash,
    DECODE_WINDOW_SECONDS,
} from '../candidateRoute';

const ORACLE_VECTORS = (goldens as unknown as { cases: { category: string; input: string; expected: string }[] }).cases;
const MODEL_ID = 'Xenova/whisper-base.en';
const WHISPER_V2 = { family: 'whisper', engine: 'v2', modelId: MODEL_ID } as const;

const provenanceOf = (): ArmProvenance => ({
    model: { id: MODEL_ID, revision: 'abc123', filesSha256: { 'model.onnx': 'a'.repeat(64) } },
    runtime: { library: '@xenova/transformers', version: '2.17.2', backend: 'wasm' },
    assets: { source: 'self-hosted /models/', verdict: 'identical' },
    device: { platform: 'darwin', arch: 'arm64', cpuModel: 'Apple M-series', cores: 10 },
    route: {
        hash: candidateRouteHash(resolveWhisperRoute('v2', MODEL_ID, 4.2)),
        route: resolveWhisperRoute('v2', MODEL_ID, 4.2),
    },
    corpus: { version: 'librispeech_test_v1', archives: { 'test-clean.tar.gz': 'b'.repeat(64) } },
    resources: { wallClockMs: 1234, peakRssBytes: 2_000_000 },
});

/** An arm that decodes from a fixed lookup — deterministic, so the expected arithmetic is knowable. */
const makeArm = (transcripts: Record<string, string | null>, overrides: Partial<DecodeArm> = {}): DecodeArm => ({
    id: 'injected-arm',
    declareRoute: (seconds) => resolveWhisperRoute('v2', MODEL_ID, seconds),
    decode: async (_locator, seconds) => transcripts[String(seconds)] ?? null,
    probeRouteHonored: async () => ({
        timestampsRequested: true,
        timestampsReturned: true,
        deviceRequested: 'injected',
        deviceClaim: 'none' as const,
        deviceResolved: 'injected-backend',
        deviceVerifiable: true,
        detail: 'injected engine',
    }),
    provenance: provenanceOf,
    ...overrides,
});

const utterance = (id: string, reference: string, audioSeconds: number): CorpusUtterance => ({
    // A locator the injected arm keys off; nothing here touches the filesystem.
    id, reference, audioSeconds, locator: `injected://${id}`,
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
            .map((s) => resolveWhisperRoute('v2', MODEL_ID, s).decode.stride_length_s);
        expect(new Set(strides).size).toBe(2);
    });

    it('an arm resolving from the shipping module passes', () => {
        const result = checkRouteParity(makeArm({}), WHISPER_V2);
        expect(result.ok).toBe(true);
        expect(result.probes.map((p) => p.probe)).toEqual(['short', 'boundary', 'long']);
    });

    it('an arm that forces a stride onto SHORT audio is refused', () => {
        // This is the disqualifying defect of `benchmark-whisper-ceiling.mts`, reproduced: a fixed
        // 5-second stride on clips far below the context window. It measures a configuration no user
        // runs, and it must not be certifiable.
        const arm = makeArm({}, {
            declareRoute: (seconds) => {
                const route = resolveWhisperRoute('v2', MODEL_ID, seconds);
                return { ...route, decode: { ...route.decode, stride_length_s: 5 } };
            },
        });
        const result = checkRouteParity(arm, WHISPER_V2);
        expect(result.ok).toBe(false);
        expect(result.probes.find((p) => p.probe === 'short')?.matched).toBe(false);
    });

    it('an arm that omits timestamps is refused', () => {
        const arm = makeArm({}, {
            declareRoute: (seconds) => {
                const route = resolveWhisperRoute('v2', MODEL_ID, seconds);
                return { ...route, decode: { ...route.decode, return_timestamps: false } };
            },
        });
        expect(checkRouteParity(arm, WHISPER_V2).ok).toBe(false);
    });

    it('an arm that agrees everywhere EXCEPT the boundary is refused', () => {
        // The boundary is where an off-by-one lives: the product uses `<`, so the window itself is
        // long-form. Short and long probes alone would both pass.
        const arm = makeArm({}, {
            declareRoute: (seconds) => {
                const route = resolveWhisperRoute('v2', MODEL_ID, seconds);
                return seconds === DECODE_WINDOW_SECONDS
                    ? { ...route, decode: { ...route.decode, stride_length_s: 0 } }
                    : route;
            },
        });
        const result = checkRouteParity(arm, WHISPER_V2);
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

    const certifyInjected = (arm: DecodeArm) => certifyArm(arm, WHISPER_V2, ORACLE_VECTORS);

    it('produces the hand-computed pooled WER, and the S/D/I that make it up', async () => {
        const arm = makeArm(TRANSCRIPTS);
        const result = await runArm(arm, certifyInjected(arm), UTTERANCES, UTTERANCES.map((u) => u.id));
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
        const result = await runArm(arm, certifyInjected(arm), UTTERANCES, UTTERANCES.map((u) => u.id));
        if (!result.ok) throw new Error(result.reason);
        const perUtterance = result.scores.map((s) => (s.ok ? s.row.wer ?? 0 : 0));
        const mean = perUtterance.reduce((a, b) => a + b, 0) / perUtterance.length;
        expect(mean).toBeCloseTo(0.2889, 3);
        expect(result.row.wer).not.toBeCloseTo(mean, 3);
    });

    it('an UNCERTIFIED arm produces no row at all', async () => {
        const arm = makeArm(TRANSCRIPTS, {
            declareRoute: (seconds) => {
                const route = resolveWhisperRoute('v2', MODEL_ID, seconds);
                return { ...route, decode: { ...route.decode, stride_length_s: 5 } };
            },
        });
        const result = await runArm(arm, certifyInjected(arm), UTTERANCES, UTTERANCES.map((u) => u.id));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('not_certified');
        expect(result.detail).toContain('route_parity');
    });

    it('a FAILED decode invalidates the arm instead of quietly improving it', async () => {
        // The retired harnesses caught the exception, skipped the clip, and divided by the survivors.
        // The clips that fail are systematically the hard ones, so skipping them raises the score.
        const arm = makeArm(TRANSCRIPTS, {
            decode: async (_locator, seconds) => {
                if (seconds === 3) throw new Error('decode exploded');
                return TRANSCRIPTS[String(seconds)];
            },
        });
        const result = await runArm(arm, certifyInjected(arm), UTTERANCES, UTTERANCES.map((u) => u.id));
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
        const result = await runArm(arm, certifyInjected(arm), UTTERANCES, UTTERANCES.map((u) => u.id));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.scores.find((s) => s.utteranceId === 'u2')).toMatchObject({
            ok: false, invalidReason: 'empty_hypothesis',
        });
        // A silent model is NOT a crash: nothing threw, so nothing is reported as having thrown.
        expect(result.decodeFailures).toEqual([]);
    });

    it('a PARTIAL corpus produces no WER — the expected ids are INDEPENDENT of what ran', async () => {
        // THE BYPASS THIS CLOSES. Every runner used to pass `utterances.map(u => u.id)` as the expected
        // set, so dropping a clip shrank both lists and 599 of 600 read as complete — the check
        // compared a list against itself. `runArm` now REQUIRES the expected ids as a separate
        // argument, taken from the set's own definition.
        const arm = makeArm(TRANSCRIPTS);
        const result = await runArm(
            arm,
            certifyInjected(arm),
            UTTERANCES.slice(0, 2),               // only two decoded
            UTTERANCES.map((u) => u.id),          // three expected, from the set
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('unscoreable_arm');
        expect(result.aggregate?.armInvalidReason).toBe('incomplete_corpus');
        expect(result.aggregate?.missingUtteranceIds).toEqual(['u3']);
    });

    it('the SAME two clips DO score when the set genuinely expects two — strictness, not refusal', async () => {
        // Positive control. Without it, a `runArm` that rejected everything would satisfy the test above.
        const arm = makeArm(TRANSCRIPTS);
        const two = UTTERANCES.slice(0, 2);
        const result = await runArm(arm, certifyInjected(arm), two, two.map((u) => u.id));
        expect(result.ok).toBe(true);
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
        const result = await runArm(arm, certifyInjected(arm), UTTERANCES, UTTERANCES.map((u) => u.id));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('incomplete_provenance');
        expect(result.detail).toContain('resources');
    });

    it('the emitted row carries the rules version that certified it', async () => {
        const arm = makeArm(TRANSCRIPTS);
        const result = await runArm(arm, certifyInjected(arm), UTTERANCES, UTTERANCES.map((u) => u.id));
        if (!result.ok) throw new Error(result.reason);
        expect(result.row.rulesVersion).toBe(CERTIFICATION_RULES.version);
        expect(result.row.armId).toBe('injected-arm');
    });
});

/**
 * VARIANT-AWARE PARITY (blocker 5).
 *
 * The v4 `base_q4` arm failed parity against a route resolved WITHOUT its variant id, so the dtype
 * appeared on one side only. The gate was comparing a correctly-configured arm against a configuration
 * the product does not ship. Both sides must carry the SAME variant, and changing or omitting it on
 * either side must fail.
 */
describe('v4 parity carries the variant on BOTH sides', () => {
    const V4_MODEL = 'onnx-community/whisper-base.en';
    const expectation = { family: 'whisper', engine: 'v4', modelId: V4_MODEL, variantId: 'base_q4' } as const;

    const v4Arm = (variantId?: 'base_q4' | 'distil_q4'): DecodeArm => ({
        ...makeArm({}),
        declareRoute: (seconds) => resolveWhisperRoute('v4', V4_MODEL, seconds, variantId),
    });

    it('the same variant on both sides MATCHES', () => {
        expect(checkRouteParity(v4Arm('base_q4'), expectation).ok).toBe(true);
    });

    it('the dtype is actually present — otherwise this test proves nothing', () => {
        // Precondition. If the variant contributed no dtype, omitting it below could not fail.
        const route = resolveWhisperRoute('v4', V4_MODEL, 4.2, 'base_q4');
        expect(route.decode.dtype).toEqual({ encoder_model: 'fp32', decoder_model_merged: 'q4' });
    });

    it('OMITTING the variant on the arm side FAILS', () => {
        expect(checkRouteParity(v4Arm(undefined), expectation).ok).toBe(false);
    });

    it('a DIFFERENT variant FAILS', () => {
        expect(checkRouteParity(v4Arm('distil_q4'), expectation).ok).toBe(false);
    });

    it('omitting it on BOTH sides matches — a variant-less arm against a variant-less expectation', () => {
        // The v4 dtype arms the product does not ship have no variant, and comparing them to one
        // would be claiming parity with something that does not exist.
        const bare = { family: 'whisper', engine: 'v4', modelId: V4_MODEL } as const;
        expect(checkRouteParity(v4Arm(undefined), bare).ok).toBe(true);
    });
});

/**
 * MOONSHINE'S OWN ROUTE (blocker 6).
 *
 * It was previously compared against the Whisper route and marked as failing for not returning
 * Whisper timestamp chunks. The product consumes transcript TEXT, so that was a requirement the
 * product does not have — a false verdict produced by comparing across families.
 */
describe('Moonshine is measured against its native route, not Whisper\'s', () => {
    const MOONSHINE = 'onnx-community/moonshine-tiny-ONNX';
    const expectation = { family: 'moonshine', engine: 'v2', modelId: MOONSHINE } as const;

    const moonshineArm = (): DecodeArm => ({
        ...makeArm({}),
        declareRoute: (seconds) => resolveMoonshineRoute(MOONSHINE, seconds),
        probeRouteHonored: async () => ({
            // Its route asks for no timestamps, so returning none is the route being HONOURED.
            timestampsRequested: false,
            timestampsReturned: false,
            deviceRequested: 'cpu',
            deviceClaim: 'none' as const,
            deviceResolved: 'test',
            deviceVerifiable: true,
            detail: 'moonshine native',
        }),
    });

    it('a native-route arm passes parity', () => {
        expect(checkRouteParity(moonshineArm(), expectation).ok).toBe(true);
    });

    it('the native route asks for NO timestamps and carries a duration-derived bound', () => {
        const short = resolveMoonshineRoute(MOONSHINE, 4);
        const long = resolveMoonshineRoute(MOONSHINE, 40);
        expect(short.returnTimestamps).toBe(false);
        expect(short.rawWaveform).toBe(true);
        expect(short.maxPositionEmbeddings).toBe(512);
        // Unbounded generation is what let a looped fixture produce a "the model loops" conclusion.
        expect(long.maxNewTokens).toBeGreaterThan(short.maxNewTokens);
        expect(long.maxNewTokens).toBeLessThanOrEqual(512);
    });

    it('NOT returning timestamps is no longer a failure for it', async () => {
        const arm = moonshineArm();
        const honor = await arm.probeRouteHonored('injected://probe', 1);
        const result = certifyArm(arm, expectation, ORACLE_VECTORS, honor);
        expect(result.failedGates).not.toContain('route_not_honored');
        expect(result.certified).toBe(true);
    });

    it('a Moonshine arm declaring a WHISPER route fails — families must not be crossed', () => {
        const wrong: DecodeArm = {
            ...moonshineArm(),
            declareRoute: (seconds) => resolveWhisperRoute('v2', MOONSHINE, seconds),
        };
        expect(checkRouteParity(wrong, expectation).ok).toBe(false);
    });
});

/**
 * A CERTIFICATE IS NOT TRANSFERABLE (blocker 2).
 *
 * Nothing previously tied a certification to the arm being run, so one model could be measured under
 * another model's certificate — including one earned on a different route, device or model entirely.
 */
describe('a certificate belongs to the arm that earned it', () => {
    const UTTERANCES: CorpusUtterance[] = [utterance('u1', 'THE CAT SAT DOWN', 1)];

    it('running arm B under arm A\'s certificate produces no row', async () => {
        const armA = makeArm({ '1': 'the cat sat down' });
        const certificate = certifyArm(armA, WHISPER_V2, ORACLE_VECTORS);
        expect(certificate.certified).toBe(true);

        const armB: DecodeArm = { ...armA, id: 'a-different-model' };
        const result = await runArm(armB, certificate, UTTERANCES, UTTERANCES.map((u) => u.id));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('certificate_arm_mismatch');
        expect(result.detail).toContain('injected-arm');
        expect(result.detail).toContain('a-different-model');
    });

    it('an arm that keeps its NAME but changes its CONFIGURATION is refused', async () => {
        // A name is not a configuration. Without the fingerprint, an arm could keep its id and change
        // its dtype, device, model revision or runtime version, and the certificate would still appear
        // to belong to it — vouching for a decode that never happened.
        const arm = makeArm({ '1': 'the cat sat down' });
        const certificate = certifyArm(arm, WHISPER_V2, ORACLE_VECTORS);

        const reconfigured: DecodeArm = {
            ...arm,
            provenance: () => {
                const p = provenanceOf();
                p.model.revision = 'a-different-revision';
                return p;
            },
        };
        const result = await runArm(reconfigured, certificate, UTTERANCES, UTTERANCES.map((u) => u.id));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('certificate_configuration_mismatch');
        // And it names WHICH field moved, so a mismatch is actionable rather than just reported.
        expect(result.detail).toContain('modelRevision');
    });

    it.each([
        ['different weights', (p: ArmProvenance) => { p.model.filesSha256 = { 'model.onnx': 'b'.repeat(64) }; }],
        ['different runtime version', (p: ArmProvenance) => { p.runtime.version = '9.9.9'; }],
        ['different backend', (p: ArmProvenance) => { p.runtime.backend = 'webgpu'; }],
        ['different corpus', (p: ArmProvenance) => { p.corpus.version = 'some_other_corpus'; }],
    ])('a %s also breaks the certificate', async (_name, mutate) => {
        const arm = makeArm({ '1': 'the cat sat down' });
        const certificate = certifyArm(arm, WHISPER_V2, ORACLE_VECTORS);
        const changed: DecodeArm = {
            ...arm,
            provenance: () => { const p = provenanceOf(); mutate(p); return p; },
        };
        const result = await runArm(changed, certificate, UTTERANCES, UTTERANCES.map((u) => u.id));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('certificate_configuration_mismatch');
    });

    it('the same arm under its own certificate still runs — the check is binding, not blocking', async () => {
        const arm = makeArm({ '1': 'the cat sat down' });
        const result = await runArm(arm, certifyArm(arm, WHISPER_V2, ORACLE_VECTORS), UTTERANCES, UTTERANCES.map((u) => u.id));
        expect(result.ok).toBe(true);
    });
});

/**
 * PLACEHOLDER PROVENANCE (blocker 3). `runtime: { version: 'unknown' }` passed every emptiness check
 * while saying exactly as much as an absent field — and saying it in a shape that reads as answered.
 */
describe('placeholder provenance is not provenance', () => {
    it.each(['unknown', 'unpinned', 'TBD', 'n/a', 'none', 'placeholder', '-'])(
        'a runtime version of "%s" fails',
        (value) => {
            const provenance = provenanceOf();
            provenance.runtime.version = value;
            const check = checkProvenance(provenance);
            expect(check.ok).toBe(false);
            expect(check.placeholder).toContain('runtime.version');
        },
    );

    it('a placeholder DIGEST inside a map fails', () => {
        // A digest map whose values are placeholders is a map of nothing.
        const provenance = provenanceOf();
        provenance.model.filesSha256 = { 'model.onnx': 'unknown' };
        expect(checkProvenance(provenance).placeholder).toContain('model.filesSha256.model.onnx');
    });

    it('a real value that merely CONTAINS a placeholder word still passes', () => {
        // The check is exact-match, not substring: "unknown-quantity-v2" is a real identifier.
        const provenance = provenanceOf();
        provenance.model.id = 'unknown-quantity-v2';
        expect(checkProvenance(provenance).ok).toBe(true);
    });
});
