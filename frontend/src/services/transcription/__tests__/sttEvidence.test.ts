import { describe, expect, it } from 'vitest';
import {
    NOT_AVAILABLE,
    buildSttEvidence,
    classifySttRun,
    computeRtf,
    type SttEvidenceInput,
} from '../sttEvidence';

/**
 * STT-EVIDENCE-SCHEMA tests.
 *
 * The point of the schema is that a bad INPUT is classified INVALID/BLOCKED, never a model FAIL,
 * and that a valid-but-empty result is FAIL (not silently passed). These tests lock the
 * precedence and the invalidReason vocabulary (shared with the release acceptance gate).
 */
describe('classifySttRun — verdict precedence', () => {
    it('returns NOT_TESTED when there are no signals at all', () => {
        expect(classifySttRun({})).toEqual({ verdict: 'NOT_TESTED', invalidReason: null });
    });

    it('BLOCKED when the environment cannot produce release evidence (envValid=false)', () => {
        // Even with otherwise-good signals, an invalid env blocks the run.
        const r = classifySttRun({ envValid: false, audioDelivered: true, transcriptLength: 50 });
        expect(r.verdict).toBe('BLOCKED');
        expect(r.invalidReason).toBe('blocked_env_invalid');
    });

    it('INVALID for impossible finalize timing (<= 0), with the offending value attached', () => {
        const r = classifySttRun({ stopFinalizationMs: 0, audioDelivered: true, transcriptLength: 10 });
        expect(r.verdict).toBe('INVALID');
        expect(r.invalidReason).toBe('invalid_impossible_timing:0');
    });

    it('INVALID_NO_AUDIO when no audio was delivered (never a model FAIL)', () => {
        const r = classifySttRun({ audioDelivered: false, transcriptLength: 0 });
        expect(r.verdict).toBe('INVALID');
        expect(r.invalidReason).toBe('invalid_no_audio_delivered');
    });

    it('INVALID when process_audio_ready never fired', () => {
        const r = classifySttRun({ audioDelivered: true, processAudioReadyCount: 0 });
        expect(r).toEqual({ verdict: 'INVALID', invalidReason: 'invalid_process_audio_ready_missing' });
    });

    it('INVALID when audio energy is all-zero (RMS and peak both ~0)', () => {
        const r = classifySttRun({ audioDelivered: true, processAudioReadyCount: 5, rmsMax: 0, peakMax: 0 });
        expect(r).toEqual({ verdict: 'INVALID', invalidReason: 'invalid_zero_audio_energy' });
    });

    it('INVALID when a speech fixture delivered audio but detected no speech onset', () => {
        const r = classifySttRun({
            audioDelivered: true,
            processAudioReadyCount: 5,
            rmsMax: 0.4,
            peakMax: 0.9,
            speechExpected: true,
            speechDetected: false,
        });
        expect(r).toEqual({ verdict: 'INVALID', invalidReason: 'invalid_no_speech_start_detected' });
    });

    it('INVALID when the worker never started / model never loaded', () => {
        expect(classifySttRun({ audioDelivered: true, processAudioReadyCount: 1, workerStarted: false }))
            .toEqual({ verdict: 'INVALID', invalidReason: 'invalid_worker_not_started' });
        expect(classifySttRun({ audioDelivered: true, processAudioReadyCount: 1, modelLoaded: false }))
            .toEqual({ verdict: 'INVALID', invalidReason: 'invalid_model_not_loaded' });
    });

    it('FAIL (not INVALID) on a valid run that errored or produced an empty transcript', () => {
        const valid = { audioDelivered: true, processAudioReadyCount: 5, rmsMax: 0.4, peakMax: 0.9, modelLoaded: true, workerStarted: true } satisfies SttEvidenceInput;
        expect(classifySttRun({ ...valid, errorClass: 'DECODE_ERROR' }))
            .toEqual({ verdict: 'FAIL', invalidReason: 'fail_error:DECODE_ERROR' });
        expect(classifySttRun({ ...valid, transcriptLength: 0 }))
            .toEqual({ verdict: 'FAIL', invalidReason: 'fail_no_transcript' });
    });

    it('PASS on a valid run with a non-empty transcript', () => {
        const r = classifySttRun({
            audioDelivered: true,
            processAudioReadyCount: 5,
            rmsMax: 0.4,
            peakMax: 0.9,
            modelLoaded: true,
            workerStarted: true,
            transcriptLength: 42,
        });
        expect(r).toEqual({ verdict: 'PASS', invalidReason: null });
    });

    it('a non-zero processAudioReadyCount and non-zero energy do not trip the INVALID gates', () => {
        const r = classifySttRun({ audioDelivered: true, processAudioReadyCount: 3, rmsMax: 0.01, peakMax: 0.2, transcriptLength: 5 });
        expect(r.verdict).toBe('PASS');
    });
});

describe('computeRtf', () => {
    it('derives decodeMs / (audioSec * 1000)', () => {
        expect(computeRtf(500, 10)).toBe(0.05); // 500ms to decode 10s of audio
        expect(computeRtf(20000, 10)).toBe(2); // slower than real time
    });
    it('is NOT_AVAILABLE when inputs are missing or audio duration is non-positive', () => {
        expect(computeRtf(undefined, 10)).toBe(NOT_AVAILABLE);
        expect(computeRtf(500, undefined)).toBe(NOT_AVAILABLE);
        expect(computeRtf(500, 0)).toBe(NOT_AVAILABLE);
    });
});

describe('buildSttEvidence — normalization', () => {
    it('fills NOT_AVAILABLE for absent fields and derives verdict/rtf/nonEmptyTranscript', () => {
        const ev = buildSttEvidence({
            tier: 'app-lifecycle',
            provider: 'transformers-js',
            modelId: 'whisper-tiny.en',
            modelSource: 'local',
            requestedDevice: 'wasm',
            resolvedDevice: 'wasm-singlethread',
            fallbackOccurred: false,
            audioDelivered: true,
            processAudioReadyCount: 8,
            rmsMax: 0.5,
            peakMax: 0.95,
            audioDurationSec: 4,
            decodeMs: 2000,
            transcriptLength: 37,
        });

        expect(ev.tier).toBe('app-lifecycle');
        expect(ev.verdict).toBe('PASS');
        expect(ev.invalidReason).toBeNull();
        expect(ev.engine.resolvedDevice).toBe('wasm-singlethread');
        expect(ev.engine.dtype).toBe(NOT_AVAILABLE); // not supplied
        expect(ev.timing.rtf).toBe(0.5); // 2000 / (4 * 1000)
        expect(ev.timing.saveMs).toBe(NOT_AVAILABLE);
        expect(ev.output.nonEmptyTranscript).toBe(true);
    });

    it('keeps timing fields SEPARATE (never blends load/decode/save)', () => {
        const ev = buildSttEvidence({ modelLoadMs: 1500, decodeMs: 800, saveMs: 120, detailHydrationMs: 60, audioDurationSec: 4, transcriptLength: 10 });
        expect(ev.timing.modelLoadMs).toBe(1500);
        expect(ev.timing.decodeMs).toBe(800);
        expect(ev.timing.saveMs).toBe(120);
        expect(ev.timing.detailHydrationMs).toBe(60);
        // rtf reflects ONLY decode, not the blended total.
        expect(ev.timing.rtf).toBe(0.2);
    });

    it('exposes WER only when a reference transcript exists', () => {
        const withRef = buildSttEvidence({ wer: 0.12, referenceText: 'hello world', transcriptLength: 11 });
        expect(withRef.output.wer).toBe(0.12);
        const noRef = buildSttEvidence({ wer: 0.12, transcriptLength: 11 });
        expect(noRef.output.wer).toBe(NOT_AVAILABLE);
    });

    it('carries the INVALID verdict + reason through to the built evidence (no-audio case)', () => {
        const ev = buildSttEvidence({ tier: 'app-lifecycle', fixtureId: 'h1_6.wav', audioDelivered: false, transcriptLength: 0 });
        expect(ev.verdict).toBe('INVALID');
        expect(ev.invalidReason).toBe('invalid_no_audio_delivered');
        expect(ev.output.nonEmptyTranscript).toBe(false);
        expect(ev.audioValidity.fixtureId).toBe('h1_6.wav');
    });
});
