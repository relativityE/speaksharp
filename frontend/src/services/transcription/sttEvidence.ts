/**
 * STT-EVIDENCE-SCHEMA — read-only evidence normalization + deterministic classifier.
 *
 * Purpose (pull-forward priority 2): make every STT run easy to classify as
 * PASS / FAIL / INVALID / BLOCKED so a bad input is never reported as a model FAIL,
 * and so a blended "decode" number never hides download/load/save time.
 *
 * This module is PURE and READ-ONLY:
 *   - it changes no engine behavior, no model defaults, no transcript text;
 *   - it only normalizes already-collected signals into one schema and derives a verdict.
 * Any field a tier cannot supply is left as `NOT_AVAILABLE` rather than forcing a refactor.
 *
 * The `invalidReason` codes intentionally MIRROR `scripts/private-corpus-acceptance.mjs`
 * (invalid_no_audio_delivered, invalid_process_audio_ready_missing, invalid_zero_audio_energy,
 * invalid_no_speech_start_detected, invalid_impossible_timing) so the schema and the release
 * acceptance gate speak the same vocabulary, and extends it where the gate had no code
 * (blocked_env_invalid, invalid_model_not_loaded, invalid_worker_not_started, fail_no_transcript,
 * fail_error).
 */

export const NOT_AVAILABLE = 'NOT_AVAILABLE' as const;
export type NotAvailable = typeof NOT_AVAILABLE;
export type Maybe<T> = T | NotAvailable;

export type SttTier = 'probe' | 'worker' | 'app-lifecycle' | 'deployed-preview';
export type SttVerdict = 'PASS' | 'FAIL' | 'INVALID' | 'BLOCKED' | 'NOT_TESTED';

/** Raw signals a caller (any tier) may have collected. All optional — tiers differ. */
export interface SttEvidenceInput {
    tier?: SttTier;

    // --- engine / selection ---
    provider?: string;
    modelId?: string;
    modelSource?: 'local' | 'remote';
    dtype?: string;
    requestedDevice?: string;
    resolvedDevice?: string;
    fallbackOccurred?: boolean;
    runtimeVersion?: string;

    // --- audio validity ---
    fixtureId?: string;
    audioDurationSec?: number;
    audioDelivered?: boolean;
    processAudioReadyCount?: number;
    /** True when the fixture is expected to contain speech (gates the no-speech check). */
    speechExpected?: boolean;
    speechDetected?: boolean;
    rmsMax?: number;
    peakMax?: number;

    // --- environment / readiness (drive BLOCKED / engine-INVALID) ---
    /** False => the run cannot be release evidence (missing env, mock auth, not eligible). */
    envValid?: boolean;
    modelLoaded?: boolean;
    workerStarted?: boolean;

    // --- timing (kept SEPARATE; never blended) ---
    modelLoadMs?: number;
    firstTextMs?: number;
    decodeMs?: number;
    finalizeMs?: number;
    /** Total stop->finalized wall time; <= 0 is impossible and marks the row INVALID. */
    stopFinalizationMs?: number;
    saveMs?: number;
    detailHydrationMs?: number;

    // --- output ---
    transcriptLength?: number;
    wer?: number;
    /** Presence indicates a reference transcript exists, so `wer` is meaningful. */
    referenceText?: string;
    /** Non-mutating evidence flag only — never used to delete/alter transcript text. */
    repetitionRisk?: boolean;

    // --- error ---
    errorClass?: string;
    rawErrorDevOnly?: string;
}

export interface SttEvidence {
    tier: Maybe<SttTier>;
    verdict: SttVerdict;
    invalidReason: string | null;

    engine: {
        provider: Maybe<string>;
        modelId: Maybe<string>;
        modelSource: Maybe<'local' | 'remote'>;
        dtype: Maybe<string>;
        requestedDevice: Maybe<string>;
        resolvedDevice: Maybe<string>;
        fallbackOccurred: Maybe<boolean>;
        runtimeVersion: Maybe<string>;
    };

    audioValidity: {
        fixtureId: Maybe<string>;
        audioDurationSec: Maybe<number>;
        audioDelivered: Maybe<boolean>;
        processAudioReadyCount: Maybe<number>;
        speechExpected: Maybe<boolean>;
        speechDetected: Maybe<boolean>;
        rmsMax: Maybe<number>;
        peakMax: Maybe<number>;
    };

    timing: {
        modelLoadMs: Maybe<number>;
        firstTextMs: Maybe<number>;
        decodeMs: Maybe<number>;
        finalizeMs: Maybe<number>;
        stopFinalizationMs: Maybe<number>;
        saveMs: Maybe<number>;
        detailHydrationMs: Maybe<number>;
        rtf: Maybe<number>;
    };

    output: {
        transcriptLength: Maybe<number>;
        nonEmptyTranscript: Maybe<boolean>;
        wer: Maybe<number>;
        repetitionRisk: Maybe<boolean>;
    };

    error: {
        errorClass: Maybe<string>;
        rawErrorDevOnly: Maybe<string>;
    };
}

function val<T>(v: T | undefined): Maybe<T> {
    return v === undefined ? NOT_AVAILABLE : v;
}

function isFiniteNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

/** RTF = decode ms / (audio seconds * 1000). < 1 means faster than real time. */
export function computeRtf(decodeMs?: number, audioDurationSec?: number): Maybe<number> {
    if (!isFiniteNumber(decodeMs) || !isFiniteNumber(audioDurationSec) || audioDurationSec <= 0) {
        return NOT_AVAILABLE;
    }
    return Number((decodeMs / (audioDurationSec * 1000)).toFixed(4));
}

/**
 * Deterministic verdict precedence (most fundamental first):
 *   1. NOT_TESTED  — no run signals at all.
 *   2. BLOCKED     — environment/auth cannot produce release evidence (envValid === false).
 *   3. INVALID     — the run did not deliver a valid model measurement:
 *                    impossible timing, no audio, no process_audio_ready, zero energy,
 *                    no speech on a speech fixture, model not loaded, worker not started.
 *   4. FAIL        — valid run, but the model output is unusable (error, or empty transcript).
 *   5. PASS        — valid run with a non-empty transcript. (Accuracy/WER thresholds are
 *                    layered by the test agent on top of a PASS; this verdict is run-validity.)
 */
export function classifySttRun(input: SttEvidenceInput): { verdict: SttVerdict; invalidReason: string | null } {
    const hasAnySignal = Object.values(input).some((v) => v !== undefined);
    if (!hasAnySignal) return { verdict: 'NOT_TESTED', invalidReason: null };

    // 2. BLOCKED — env/auth invalid.
    if (input.envValid === false) {
        return { verdict: 'BLOCKED', invalidReason: 'blocked_env_invalid' };
    }

    // 3. INVALID — ordered to match scripts/private-corpus-acceptance.mjs, then engine readiness.
    if (isFiniteNumber(input.stopFinalizationMs) && input.stopFinalizationMs <= 0) {
        return { verdict: 'INVALID', invalidReason: `invalid_impossible_timing:${input.stopFinalizationMs}` };
    }
    if (input.audioDelivered === false) {
        return { verdict: 'INVALID', invalidReason: 'invalid_no_audio_delivered' };
    }
    if (isFiniteNumber(input.processAudioReadyCount) && input.processAudioReadyCount <= 0) {
        return { verdict: 'INVALID', invalidReason: 'invalid_process_audio_ready_missing' };
    }
    // Zero audio energy: only decisive when both RMS and peak are known and both are ~0.
    if (isFiniteNumber(input.rmsMax) && isFiniteNumber(input.peakMax) && input.rmsMax <= 0 && input.peakMax <= 0) {
        return { verdict: 'INVALID', invalidReason: 'invalid_zero_audio_energy' };
    }
    // Speech fixture that delivered audio but never detected speech onset.
    if (input.speechExpected === true && input.speechDetected === false) {
        return { verdict: 'INVALID', invalidReason: 'invalid_no_speech_start_detected' };
    }
    if (input.workerStarted === false) {
        return { verdict: 'INVALID', invalidReason: 'invalid_worker_not_started' };
    }
    if (input.modelLoaded === false) {
        return { verdict: 'INVALID', invalidReason: 'invalid_model_not_loaded' };
    }

    // 4. FAIL — valid run, unusable output.
    if (typeof input.errorClass === 'string' && input.errorClass.length > 0) {
        return { verdict: 'FAIL', invalidReason: `fail_error:${input.errorClass}` };
    }
    if (isFiniteNumber(input.transcriptLength) && input.transcriptLength <= 0) {
        return { verdict: 'FAIL', invalidReason: 'fail_no_transcript' };
    }

    // 5. PASS — valid run with a non-empty transcript (when transcript length is known).
    if (isFiniteNumber(input.transcriptLength) && input.transcriptLength > 0) {
        return { verdict: 'PASS', invalidReason: null };
    }

    // Signals present but not enough to assert output validity (e.g. probe with no transcript field).
    return { verdict: 'NOT_TESTED', invalidReason: null };
}

/** Normalize raw signals into the full evidence schema, filling NOT_AVAILABLE and deriving fields. */
export function buildSttEvidence(input: SttEvidenceInput): SttEvidence {
    const { verdict, invalidReason } = classifySttRun(input);

    const nonEmptyTranscript: Maybe<boolean> = isFiniteNumber(input.transcriptLength)
        ? input.transcriptLength > 0
        : NOT_AVAILABLE;

    // WER is only meaningful when a reference transcript exists.
    const wer: Maybe<number> =
        typeof input.referenceText === 'string' && input.referenceText.length > 0 && isFiniteNumber(input.wer)
            ? input.wer
            : NOT_AVAILABLE;

    return {
        tier: val(input.tier),
        verdict,
        invalidReason,
        engine: {
            provider: val(input.provider),
            modelId: val(input.modelId),
            modelSource: val(input.modelSource),
            dtype: val(input.dtype),
            requestedDevice: val(input.requestedDevice),
            resolvedDevice: val(input.resolvedDevice),
            fallbackOccurred: val(input.fallbackOccurred),
            runtimeVersion: val(input.runtimeVersion),
        },
        audioValidity: {
            fixtureId: val(input.fixtureId),
            audioDurationSec: val(input.audioDurationSec),
            audioDelivered: val(input.audioDelivered),
            processAudioReadyCount: val(input.processAudioReadyCount),
            speechExpected: val(input.speechExpected),
            speechDetected: val(input.speechDetected),
            rmsMax: val(input.rmsMax),
            peakMax: val(input.peakMax),
        },
        timing: {
            modelLoadMs: val(input.modelLoadMs),
            firstTextMs: val(input.firstTextMs),
            decodeMs: val(input.decodeMs),
            finalizeMs: val(input.finalizeMs),
            stopFinalizationMs: val(input.stopFinalizationMs),
            saveMs: val(input.saveMs),
            detailHydrationMs: val(input.detailHydrationMs),
            rtf: computeRtf(input.decodeMs, input.audioDurationSec),
        },
        output: {
            transcriptLength: val(input.transcriptLength),
            nonEmptyTranscript,
            wer,
            repetitionRisk: val(input.repetitionRisk),
        },
        error: {
            errorClass: val(input.errorClass),
            rawErrorDevOnly: val(input.rawErrorDevOnly),
        },
    };
}
