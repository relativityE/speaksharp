import { describe, it, expect } from 'vitest';
import {
    finalizeRow,
    deriveAudioRouteProven,
    rankableRows,
    rankableCohorts,
    cohortKey,
    PERCENTILE_POLICY,
    type AudioRouteEvidence,
    type SttEvidenceRow,
} from '../sttEvidenceSchema';

const FIXTURE_HASH = 'a'.repeat(64);
const IMMUTABLE_REV = 'e7f3c1a9b2d4';
const FULL_SHA = '58d0150bf18708fe645f226aac10ee0adeadfe36';

const route = (over: Partial<AudioRouteEvidence> = {}): AudioRouteEvidence => ({
    fixtureSha256: FIXTURE_HASH,
    adapterInputPayloadSha256: 'b'.repeat(64),
    adapterInputBytes: 320_000,
    decodedSampleCount: 160_000,
    decodedDurationSeconds: 10,
    ...over,
});

type RawRow = Parameters<typeof finalizeRow>[0];
const base = (over: Partial<RawRow> = {}): RawRow => ({
    comparability_class: 'corpus_fixture',
    engine: 'private',
    engine_version: 'whisper-base.en@v2',
    model_name: 'whisper-base.en',
    attribution_status: 'verified',
    browser: 'Chromium',
    browser_version: '140.0.0.0',
    os: 'linux',
    device: 'ci-runner',
    network_condition: 'unthrottled',
    fixture_id: 'harvard-01',
    wer: 0.05,
    first_partial_latency_ms: 800,
    finalization_latency_ms: 4200,
    failure_class: 'none',
    release_sha: FULL_SHA,
    audio_route_evidence: route(),
    runtime_capability: {
        requestedThreads: 4, configuredThreads: 4, workerReportedThreads: 4,
        runtimePath: 'wasm-multithread', crossOriginIsolated: true,
        sharedArrayBufferAvailable: true, fallbackReason: null,
    },
    comparability_inputs: {
        fixtureHash: FIXTURE_HASH, groundTruthVersion: 'gt-v1', normalizationVersion: 'norm-v1',
        decodeConfiguration: 'q8/q8/wasm/worker/4', modelRevision: IMMUTABLE_REV,
        runtimeVersions: { onnxruntime: '1.27.0' },
    },
    ...over,
});

describe('#1037 corpus evidence schema — fail-closed admissibility', () => {
    it('a complete, route-proven row is valid and rankable', () => {
        const r = finalizeRow(base());
        expect(r.run_validity).toBe('valid');
        expect(r.audio_route_proven).toBe(true);
        expect(r.invalid_reason).toBeNull();
        expect(r.wer).toBe(0.05);
        expect(rankableRows([r])).toHaveLength(1);
    });

    it('carries every #1037 required schema field, plus attribution and model_name', () => {
        const r = finalizeRow(base()) as unknown as Record<string, unknown>;
        for (const f of [
            'comparability_class', 'engine', 'engine_version', 'model_name', 'attribution_status',
            'browser', 'browser_version', 'os', 'device', 'network_condition', 'fixture_id',
            'audio_route_proven', 'run_validity', 'invalid_reason', 'wer', 'first_partial_latency_ms',
            'finalization_latency_ms', 'failure_class', 'release_sha',
        ]) {
            expect(f in r, `required field ${f} missing`).toBe(true);
        }
    });

    it('a start timestamp is NOT route proof — an empty adapter payload fails closed', () => {
        const r = finalizeRow(base({ audio_route_evidence: route({ adapterInputBytes: 0 }) }));
        expect(r.audio_route_proven).toBe(false);
        expect(r.run_validity).toBe('invalid');
        expect(r.invalid_reason).toMatch(/payload is empty/);
        expect(r.failure_class).toBe('audio_route_unproven');
    });

    it('zero decoded samples fails closed even when the fixture hash is present', () => {
        const r = finalizeRow(base({ audio_route_evidence: route({ decodedSampleCount: 0 }) }));
        expect(r.audio_route_proven).toBe(false);
        expect(r.invalid_reason).toMatch(/no decoded samples/);
    });

    it('WER is dropped (never estimated or zeroed) when the route is unproven', () => {
        const r = finalizeRow(base({ wer: 0.02, audio_route_evidence: route({ decodedDurationSeconds: 0 }) }));
        expect(r.audio_route_proven).toBe(false);
        expect(r.wer).toBeNull();
        expect(rankableRows([r])).toHaveLength(0);
    });

    it('cloud rows additionally require submitted-payload hash AND provider job id', () => {
        const missingBoth = deriveAudioRouteProven(route(), 'cloud');
        expect(missingBoth.proven).toBe(false);
        expect(missingBoth.reason).toMatch(/submitted-payload hash/);

        const missingJob = deriveAudioRouteProven(route({ submittedPayloadSha256: 'c'.repeat(64) }), 'cloud');
        expect(missingJob.proven).toBe(false);
        expect(missingJob.reason).toMatch(/provider job id/);

        const complete = deriveAudioRouteProven(
            route({ submittedPayloadSha256: 'c'.repeat(64), providerJobId: 'job_123' }), 'cloud');
        expect(complete.proven).toBe(true);
    });

    it('the same evidence is proven for a local engine without cloud-only fields', () => {
        expect(deriveAudioRouteProven(route(), 'private').proven).toBe(true);
    });

    it('a mismatched fixture hash invalidates the row (one canonical hash)', () => {
        const r = finalizeRow(base({
            comparability_inputs: { ...base().comparability_inputs, fixtureHash: 'd'.repeat(64) },
        }));
        expect(r.run_validity).toBe('invalid');
        expect(r.invalid_reason).toMatch(/does not match the routed fixture/);
    });

    it('missing required schema fields are reported individually and invalidate the row', () => {
        const r = finalizeRow(base({ browser_version: '', network_condition: '' }));
        expect(r.run_validity).toBe('invalid');
        expect(r.invalid_reason).toMatch(/missing browser_version/);
        expect(r.invalid_reason).toMatch(/missing network_condition/);
    });

    it('missing versioned comparability inputs invalidate the row', () => {
        const r = finalizeRow(base({
            comparability_inputs: { ...base().comparability_inputs, normalizationVersion: '' },
        }));
        expect(r.run_validity).toBe('invalid');
        expect(r.invalid_reason).toMatch(/missing comparability input normalizationVersion/);
    });

    it('single-thread fallback is a VALID recorded result, not a failure', () => {
        const r = finalizeRow(base({
            runtime_capability: {
                requestedThreads: 4, configuredThreads: 1, workerReportedThreads: 1,
                runtimePath: 'wasm', crossOriginIsolated: false, sharedArrayBufferAvailable: false,
                fallbackReason: 'crossOriginIsolated=false — SharedArrayBuffer unavailable',
            },
        }));
        expect(r.run_validity).toBe('valid');
        expect(r.runtime_capability.fallbackReason).toContain('crossOriginIsolated');
    });

    it('a Browser journey passes only after real recognition, timer, transcript, and session proof', () => {
        const r = finalizeRow(base({
            comparability_class: 'browser_journey',
            engine: 'browser-webspeech',
            runtime_capability: {
                requestedThreads: null, configuredThreads: null, workerReportedThreads: null,
                runtimePath: 'browser-webspeech', crossOriginIsolated: false,
                sharedArrayBufferAvailable: false, fallbackReason: null,
            },
            browser_journey_evidence: {
                supportState: 'supported', executionMode: 'manual-assisted',
                recognitionStarted: true, timerAdvanced: true, transcriptProduced: true,
                sessionProduced: true, browserManagedTranscription: true,
                applicationServerWrites: 0, cloudProviderCalls: 0,
            },
        }));
        expect(r.run_validity).toBe('valid');
    });

    it.each([
        ['recognitionStarted', false, /recognition did not actually start/i],
        ['timerAdvanced', false, /timer did not advance/i],
        ['transcriptProduced', false, /no transcript/i],
        ['sessionProduced', false, /no session/i],
    ] as const)('Browser journey fails closed when %s is not proven', (field, value, reason) => {
        const r = finalizeRow(base({
            comparability_class: 'browser_journey',
            engine: 'browser-webspeech',
            browser_journey_evidence: {
                supportState: 'supported', executionMode: 'manual-assisted',
                recognitionStarted: true, timerAdvanced: true, transcriptProduced: true,
                sessionProduced: true, browserManagedTranscription: true,
                applicationServerWrites: 0, cloudProviderCalls: 0,
                [field]: value,
            },
        }));
        expect(r.run_validity).toBe('invalid');
        expect(r.invalid_reason).toMatch(reason);
    });

    it('Private browser-worker evidence requires matching main/worker hashes and self-hosted assets', () => {
        const inputHash = 'c'.repeat(64);
        const r = finalizeRow(base({
            engine: 'private-v2-browser-worker',
            private_worker_evidence: {
                workerUsed: true, modelSource: 'self-hosted', modelLoaded: 'whisper-base.en',
                mainThreadInputSha256: inputHash, workerInputSha256: inputHash,
                inputHashesMatch: true, cloudProviderCalls: 0,
            },
        }));
        expect(r.run_validity).toBe('valid');

        const mismatch = finalizeRow(base({
            engine: 'private-v2-browser-worker',
            private_worker_evidence: {
                workerUsed: true, modelSource: 'self-hosted', modelLoaded: 'whisper-base.en',
                mainThreadInputSha256: inputHash, workerInputSha256: 'd'.repeat(64),
                inputHashesMatch: false, cloudProviderCalls: 0,
            },
        }));
        expect(mismatch.run_validity).toBe('invalid');
        expect(mismatch.invalid_reason).toMatch(/PCM hashes do not match/i);
    });

    it('thread reporting distinguishes requested / configured / worker-reported; unreported is null not inferred', () => {
        const r = finalizeRow(base({
            runtime_capability: { ...base().runtime_capability, configuredThreads: 4, workerReportedThreads: null },
        }));
        expect(r.runtime_capability.requestedThreads).toBe(4);
        expect(r.runtime_capability.configuredThreads).toBe(4);
        expect(r.runtime_capability.workerReportedThreads).toBeNull(); // configuration is NOT proof of use
    });

    it('rankableRows excludes invalid and unproven rows', () => {
        const good = finalizeRow(base());
        const bad = finalizeRow(base({ fixture_id: 'harvard-02', audio_route_evidence: route({ adapterInputBytes: 0 }) }));
        expect(rankableRows([good, bad] as SttEvidenceRow[])).toEqual([good]);
    });

    it('unverified attribution makes engine evidence inadmissible (#1033)', () => {
        for (const st of ['pending', 'unverified', 'legacy_unknown'] as const) {
            const r = finalizeRow(base({ attribution_status: st }));
            expect(r.run_validity, `${st} must be inadmissible`).toBe('invalid');
            expect(r.invalid_reason).toMatch(/not 'verified'/);
            expect(rankableRows([r])).toHaveLength(0);
        }
    });

    it('a mutable model revision is rejected — comparability must be immutable', () => {
        for (const rev of ['main', 'master', 'latest']) {
            const r = finalizeRow(base({
                comparability_inputs: { ...base().comparability_inputs, modelRevision: rev },
            }));
            expect(r.run_validity, `${rev} must be rejected`).toBe('invalid');
            expect(r.invalid_reason).toMatch(/is mutable/);
        }
    });

    it('an empty runtimeVersions map is rejected — a silent runtime upgrade would void the ranking', () => {
        const r = finalizeRow(base({
            comparability_inputs: { ...base().comparability_inputs, runtimeVersions: {} },
        }));
        expect(r.run_validity).toBe('invalid');
        expect(r.invalid_reason).toMatch(/runtimeVersions must be a non-empty map/);
    });

    it('cohorts are separated: rows differing in model/runtime/fixture are never one ranking', () => {
        const a = finalizeRow(base());
        const b = finalizeRow(base({
            fixture_id: 'harvard-02',
            comparability_inputs: { ...base().comparability_inputs, runtimeVersions: { onnxruntime: '1.28.0' } },
        }));
        expect(rankableRows([a, b])).toHaveLength(2);          // both are individually admissible...
        expect(rankableCohorts([a, b]).size).toBe(2);          // ...but they are NOT comparable
        expect(cohortKey(a)).not.toBe(cohortKey(b));
    });

    it('same-cohort rows group together', () => {
        const a = finalizeRow(base());
        const b = finalizeRow(base({ fixture_id: 'harvard-01' }));
        expect(rankableCohorts([a, b]).size).toBe(1);
    });

    it('an abbreviated release_sha is rejected — evidence must name the exact deployed commit', () => {
        for (const sha of ['772dfc12', '58d0150', '', 'not-a-sha']) {
            const r = finalizeRow(base({ release_sha: sha }));
            expect(r.run_validity, `${sha || '(empty)'} must be rejected`).toBe('invalid');
        }
        expect(finalizeRow(base({ release_sha: FULL_SHA })).run_validity).toBe('valid');
    });

    it('a single corpus execution may not claim a percentile', () => {
        expect(PERCENTILE_POLICY.minRunsForPercentile).toBeGreaterThan(1);
        expect(PERCENTILE_POLICY.requiresWarmColdClassification).toBe(true);
        expect(PERCENTILE_POLICY.note).toMatch(/observations only/);
    });
});
