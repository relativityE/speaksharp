import { describe, it, expect } from 'vitest';
import { buildCorpusRow, summarizeLatency, type CorpusRunInput, type CorpusRow } from '../corpusLane';
import { cohortKey, type AudioRouteEvidence, type RuntimeCapability, type ComparabilityInputs } from '../sttEvidenceSchema';
import { NORMALIZATION_VERSION_V2 } from '../werMetric';

const SHA = 'a'.repeat(40);
const provenRoute: AudioRouteEvidence = {
    fixtureSha256: 'f'.repeat(64),
    adapterInputPayloadSha256: 'b'.repeat(64),
    adapterInputBytes: 32000,
    decodedSampleCount: 16000,
    decodedDurationSeconds: 1.0,
};
const runtime: RuntimeCapability = {
    requestedThreads: 4, configuredThreads: 4, workerReportedThreads: 4,
    runtimePath: 'wasm-multithread', crossOriginIsolated: true, sharedArrayBufferAvailable: true, fallbackReason: null,
};
const ci: ComparabilityInputs = {
    fixtureHash: 'f'.repeat(64), groundTruthVersion: 'gt_v1', normalizationVersion: 'IGNORED',
    decodeConfiguration: 'pcm16k_mono', modelRevision: 'whisper-base.en@sha-1234', runtimeVersions: { onnxruntime: '1.27.0' },
};
const base = (over: Partial<CorpusRunInput> = {}): CorpusRunInput => ({
    engine: 'private', engineVersion: 'private_v2:whisper-base.en', modelName: 'whisper-base.en',
    attributionStatus: 'verified',
    environment: { browser: 'node-harness', browserVersion: '0', os: 'linux', device: 'ci', networkCondition: 'offline' },
    fixtureId: 'fixture-001', releaseSha: SHA, audioRoute: provenRoute, runtime, comparabilityInputs: ci,
    firstPartialLatencyMs: 120, finalizationLatencyMs: 900, failureClass: 'none',
    groundTruth: 'the quick brown fox', recognizerTranscript: 'the quick brown fox', thermalState: 'cold', ...over,
});

describe('#1037 corpusLane — schema-valid rows, fail-closed, honest WER/percentiles', () => {
    it('a proven route + real transcript + ground truth yields a VALID row with a real WER', () => {
        const r = buildCorpusRow(base({ recognizerTranscript: 'the quick brown dog' })); // 1 sub / 4
        expect(r.run_validity).toBe('valid');
        expect(r.audio_route_proven).toBe(true);
        expect(r.wer).toBeCloseTo(1 / 4, 10);
        // #1304: this previously asserted NORMALIZATION_VERSION ('norm_v1') — the value the row WRONGLY
        // claimed while the WER above was computed under the official Track A normalization. The test
        // was pinning the mismatch as if it were the contract. Provenance now comes from the ACTUAL
        // WerResult, so the row reports the normalization and track it really used.
        expect(r.comparability_inputs.normalizationVersion).toBe(NORMALIZATION_VERSION_V2);
        expect(r.comparability_inputs.track).toBe('track_a');
    });

    it('an UNPROVEN route (offline: zero adapter bytes) is EXCLUDED, WER dropped, reason recorded', () => {
        const r = buildCorpusRow(base({
            audioRoute: { ...provenRoute, adapterInputBytes: 0, decodedSampleCount: 0 },
            recognizerTranscript: 'the quick brown fox',
        }));
        expect(r.run_validity).toBe('invalid');
        expect(r.audio_route_proven).toBe(false);
        expect(r.wer).toBeNull();               // never scored on an unproven route
        expect(r.wer_detail).toBeNull();
        expect(r.failure_class).toBe('audio_route_unproven');
        expect(r.invalid_reason).toMatch(/route unproven/i);
    });

    it('unverified attribution is inadmissible even with a proven route', () => {
        const r = buildCorpusRow(base({ attributionStatus: 'unverified' }));
        expect(r.run_validity).toBe('invalid');
        expect(r.invalid_reason).toMatch(/attribution/i);
    });

    it('an abbreviated release SHA is rejected', () => {
        const r = buildCorpusRow(base({ releaseSha: 'abc1234' }));
        expect(r.run_validity).toBe('invalid');
        expect(r.invalid_reason).toMatch(/40-character/);
    });

    it('WER stays null when there is no ground truth (unmeasurable, never 0)', () => {
        const r = buildCorpusRow(base({ groundTruth: null }));
        expect(r.wer).toBeNull();
    });

    it('a single (or small) execution emits observations only — never a p95', () => {
        const rows: CorpusRow[] = [buildCorpusRow(base())];
        const s = summarizeLatency(rows, 'finalization_latency_ms');
        expect(s.cold.p95).toBeNull();
        expect(s.warm.p95).toBeNull();
        expect(s.cold.observations).toEqual([900]);
        expect(s.note).toMatch(/repeated runs/i);
    });

    it('reports cold and warm as SEPARATE distributions and never combines them into one p95', () => {
        // 24 warm (>=20 -> warm p95) + 1 cold (<20 -> cold p95 null). Cold is never folded into warm.
        const rows: CorpusRow[] = Array.from({ length: 25 }, (_, i) =>
            buildCorpusRow(base({ finalizationLatencyMs: 800 + i, thermalState: i === 0 ? 'cold' : 'warm' })));
        const s = summarizeLatency(rows, 'finalization_latency_ms');
        expect(s.runs).toBe(25);
        expect(s.cold.runs).toBe(1);
        expect(s.warm.runs).toBe(24);
        expect(s.cold.p95).toBeNull();       // 1 cold run — no percentile
        expect(s.warm.p95).not.toBeNull();   // 24 warm runs — its own classified distribution
    });

    it('a warm class below the policy minimum still refuses a warm p95', () => {
        const rows: CorpusRow[] = Array.from({ length: 10 }, () => buildCorpusRow(base({ thermalState: 'warm' })));
        expect(summarizeLatency(rows, 'finalization_latency_ms').warm.p95).toBeNull();
    });

    it('a NEGATIVE latency INVALIDATES the row (not merely dropped from the percentile)', () => {
        const r = buildCorpusRow(base({ finalizationLatencyMs: -5 }));
        expect(r.run_validity).toBe('invalid');
        expect(r.invalid_reason).toMatch(/negative latency/i);
        expect(r.wer).toBeNull();            // an invalid row carries no scored metrics
        expect(r.filler_metric).toBeNull();
        expect(r.punctuation_metric).toBeNull();
    });

    it('an invalid negative-latency row is excluded from the latency summary entirely', () => {
        const rows: CorpusRow[] = [
            ...Array.from({ length: 20 }, () => buildCorpusRow(base({ finalizationLatencyMs: 900, thermalState: 'warm' }))),
            buildCorpusRow(base({ finalizationLatencyMs: -5, thermalState: 'warm' })), // invalid → excluded
        ];
        const s = summarizeLatency(rows, 'finalization_latency_ms');
        expect(s.warm.observations).not.toContain(-5);
        expect(s.warm.runs).toBe(20);
        expect(s.warm.min).toBe(900);
    });

    it('emits filler + punctuation metrics on a proven route, and null on an unproven one', () => {
        const proven = buildCorpusRow(base({
            groundTruth: 'so um I think uh we should review. thanks.',
            recognizerTranscript: 'so I think we should review. thanks.', // fillers dropped, punctuation kept
        }));
        expect(proven.filler_metric).not.toBeNull();
        expect(proven.filler_metric!.version).toBe('filler_v1');
        expect(proven.filler_metric!.referenceCount).toBe(2);   // um, uh in the reference
        expect(proven.filler_metric!.recall).toBe(0);           // recognizer dropped both — honest low recall
        expect(proven.punctuation_metric!.version).toBe('punct_v1');

        const unproven = buildCorpusRow(base({ audioRoute: { ...provenRoute, adapterInputBytes: 0, decodedSampleCount: 0 } }));
        expect(unproven.filler_metric).toBeNull();
        expect(unproven.punctuation_metric).toBeNull();
    });

    it('REFUSES to aggregate rows from different cohorts (throws)', () => {
        const a = buildCorpusRow(base());
        const b = buildCorpusRow(base({ comparabilityInputs: { ...ci, runtimeVersions: { onnxruntime: '9.9.9' } } }));
        expect(() => summarizeLatency([a, b], 'finalization_latency_ms')).toThrow(/distinct cohorts/i);
    });

    it('rows differing only by runtime version fall into different cohorts (no silent cross-ranking)', () => {
        const a = buildCorpusRow(base());
        const b = buildCorpusRow(base({ comparabilityInputs: { ...ci, runtimeVersions: { onnxruntime: '1.28.0' } } }));
        expect(cohortKey(a)).not.toBe(cohortKey(b));
    });
});
