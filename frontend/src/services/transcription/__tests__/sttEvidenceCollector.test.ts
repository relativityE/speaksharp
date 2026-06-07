import { describe, expect, it } from 'vitest';
import { NOT_AVAILABLE } from '../sttEvidence';
import { collectSttEvidence, readSttEvidenceSources, type SttEvidenceSources } from '../sttEvidenceCollector';

/**
 * STT-EVIDENCE collector (step 2) tests. The collector is read-only and must:
 *  - map the diagnostic globals onto the schema,
 *  - keep timing fields separate,
 *  - leave fields NOT_AVAILABLE when their source global is absent (no fabricated 0),
 *  - never infer PASS from an absent transcript,
 *  - classify a no-audio run INVALID, not a model FAIL.
 */
describe('collectSttEvidence — mapping diagnostic globals to the schema', () => {
    const goodRun: SttEvidenceSources = {
        timing: {
            timeToFirstProvisionalMs: 700,
            timeToFirstFinalMs: 1800,
            finalizeDecodeMs: 2200,
            finalizeWaitMs: 150,
            utteranceSeconds: 4.4,
        },
        inferenceChunks: [{ durationSec: 2.2, rms: 0.3, peak: 0.8 }, { durationSec: 2.2, rms: 0.42, peak: 0.91 }],
        utteranceChunks: [{ durationSec: 4.4, rms: 0.4, peak: 0.95 }],
        timeline: [
            { event: 'stream_start' },
            { event: 'speech_start_detected' },
            { event: 'process_audio_ready' },
            { event: 'process_audio_ready' },
            { event: 'model_inference_result' },
        ],
        modelTelemetry: { model: 'whisper-tiny.en', runtime: 'transformers-js', loadTimeMs: 1200, fallbackPath: 'local-then-remote', cloudFallbackAttempted: false },
        runtimeDebug: { serviceMode: 'private', transcriptLength: 37, saveCandidate: { selectedForSaveLength: 37, repetitionRisk: false } },
    };

    it('produces PASS with separate, correctly-mapped timing for a valid run', () => {
        const ev = collectSttEvidence(goodRun);
        expect(ev.verdict).toBe('PASS');
        expect(ev.engine.modelId).toBe('whisper-tiny.en');
        expect(ev.engine.provider).toBe('private');
        expect(ev.engine.modelSource).toBe('local'); // local-then-remote
        expect(ev.engine.fallbackOccurred).toBe(false);
        expect(ev.timing.modelLoadMs).toBe(1200);
        expect(ev.timing.firstTextMs).toBe(700); // timeToFirstProvisional preferred
        expect(ev.timing.decodeMs).toBe(2200); // finalizeDecodeMs only — not blended
        expect(ev.timing.finalizeMs).toBe(150);
        expect(ev.timing.rtf).toBe(0.5); // 2200 / (4.4*1000)
        expect(ev.audioValidity.processAudioReadyCount).toBe(2);
        expect(ev.audioValidity.speechDetected).toBe(true);
        expect(ev.audioValidity.audioDelivered).toBe(true);
        expect(ev.audioValidity.rmsMax).toBeCloseTo(0.42, 5);
        expect(ev.audioValidity.peakMax).toBeCloseTo(0.95, 5);
        expect(ev.output.transcriptLength).toBe(37);
        expect(ev.output.nonEmptyTranscript).toBe(true);
    });

    it('classifies a no-audio run INVALID (never a model FAIL)', () => {
        const ev = collectSttEvidence({
            timeline: [{ event: 'stream_start' }], // delivered no audio chunks, no process_audio_ready
            inferenceChunks: [],
            utteranceChunks: [],
            runtimeDebug: { transcriptLength: 0, saveCandidate: null },
        });
        expect(ev.verdict).toBe('INVALID');
        expect(ev.audioValidity.audioDelivered).toBe(false);
        expect(ev.invalidReason).toBe('invalid_no_audio_delivered');
    });

    it('leaves fields NOT_AVAILABLE when trace globals are absent (no fabricated 0 / no false INVALID)', () => {
        // Trace off: only model telemetry present, no timeline/chunks/timing.
        const ev = collectSttEvidence({ modelTelemetry: { model: 'whisper-base.en', runtime: 'transformers-js', loadTimeMs: 3400, fallbackPath: 'remote-only' } });
        expect(ev.audioValidity.audioDelivered).toBe(NOT_AVAILABLE);
        expect(ev.audioValidity.processAudioReadyCount).toBe(NOT_AVAILABLE);
        expect(ev.audioValidity.rmsMax).toBe(NOT_AVAILABLE);
        expect(ev.timing.decodeMs).toBe(NOT_AVAILABLE);
        expect(ev.engine.modelSource).toBe('remote'); // remote-only
        expect(ev.timing.modelLoadMs).toBe(3400);
        // No transcript signal => must NOT be PASS.
        expect(ev.verdict).not.toBe('PASS');
        expect(ev.output.transcriptLength).toBe(NOT_AVAILABLE);
    });

    it('honors harness-only overrides (fixtureId, referenceText/wer, stopFinalizationMs) over collected values', () => {
        const ev = collectSttEvidence(goodRun, {
            tier: 'app-lifecycle',
            fixtureId: 'h1_6.wav',
            referenceText: 'they like told wild tales to frighten him',
            wer: 0.08,
            saveMs: 90,
            detailHydrationMs: 40,
        });
        expect(ev.audioValidity.fixtureId).toBe('h1_6.wav');
        expect(ev.output.wer).toBe(0.08); // gated on referenceText, supplied via override
        expect(ev.timing.saveMs).toBe(90);
        expect(ev.timing.detailHydrationMs).toBe(40);
        expect(ev.verdict).toBe('PASS');
    });

    it('an impossible stopFinalization override is INVALID even on an otherwise-good run', () => {
        const ev = collectSttEvidence(goodRun, { stopFinalizationMs: 0 });
        expect(ev.verdict).toBe('INVALID');
        expect(ev.invalidReason).toBe('invalid_impossible_timing:0');
    });

    it('falls back to chunk-sum audio duration when timing omits utteranceSeconds', () => {
        const ev = collectSttEvidence({
            inferenceChunks: [{ durationSec: 1.5, rms: 0.2, peak: 0.5 }, { durationSec: 1.5, rms: 0.2, peak: 0.5 }],
            timeline: [{ event: 'process_audio_ready' }, { event: 'speech_start_detected' }],
            runtimeDebug: { transcriptLength: 12, saveCandidate: { selectedForSaveLength: 12, repetitionRisk: false } },
        });
        expect(ev.audioValidity.audioDurationSec).toBeCloseTo(3.0, 3);
        expect(ev.verdict).toBe('PASS');
    });
});

describe('collectSttEvidence — v4 runtime + error surfacing', () => {
    it('surfaces v4 resolvedDevice/dtype/runtime and a decode errorClass (not bare fail_no_transcript)', () => {
        const ev = collectSttEvidence({
            timeline: [{ event: 'process_audio_ready' }, { event: 'speech_start_detected' }],
            inferenceChunks: [{ durationSec: 41.5, rms: 0.4, peak: 0.9 }],
            runtimeDebug: { transcriptLength: 0, saveCandidate: null },
            v4Runtime: {
                provider: 'transformers-js-v4',
                modelId: 'onnx-community/whisper-base.en',
                modelSource: 'hf',
                dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
                requestedDevice: 'webgpu',
                resolvedDevice: 'webgpu',
                fallbackOccurred: false,
                transformersVersion: '3.7.5',
                onnxRuntimeVersion: '1.x',
            },
            v4LastError: { errorClass: 'Error', message: 'invalid data location: undefined for input "a"' },
        });
        expect(ev.engine.provider).toBe('transformers-js-v4');
        expect(ev.engine.resolvedDevice).toBe('webgpu');
        expect(ev.engine.modelSource).toBe('remote'); // hf -> remote
        expect(ev.engine.dtype).toContain('decoder_model_merged=q8');
        expect(ev.engine.runtimeVersion).toContain('3.7.5');
        // A real decode error must classify FAIL with the concrete class, not fail_no_transcript.
        expect(ev.verdict).toBe('FAIL');
        expect(ev.invalidReason).toBe('fail_error:Error');
        expect(ev.error.errorClass).toBe('Error');
    });

    it('a successful v4 run reports PASS with v4 device identity', () => {
        const ev = collectSttEvidence({
            timeline: [{ event: 'process_audio_ready' }, { event: 'speech_start_detected' }],
            inferenceChunks: [{ durationSec: 4, rms: 0.4, peak: 0.9 }],
            runtimeDebug: { transcriptLength: 33, saveCandidate: { selectedForSaveLength: 33, repetitionRisk: false } },
            v4Runtime: { provider: 'transformers-js-v4', resolvedDevice: 'webgpu', modelSource: 'hf' },
        });
        expect(ev.verdict).toBe('PASS');
        expect(ev.engine.resolvedDevice).toBe('webgpu');
    });
});

describe('readSttEvidenceSources', () => {
    it('does not throw and yields all-absent sources when no diagnostic globals are present', () => {
        const sources = readSttEvidenceSources(); // clean jsdom window: no globals set
        expect(sources.timing ?? null).toBeNull();
        expect(sources.timeline ?? null).toBeNull();
        expect(sources.runtimeDebug ?? null).toBeNull();
        // Collecting from absent sources must be NOT_TESTED — never a fabricated PASS/FAIL.
        expect(collectSttEvidence({}).verdict).toBe('NOT_TESTED');
    });
});
