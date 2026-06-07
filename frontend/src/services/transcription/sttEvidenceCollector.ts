/**
 * STT-EVIDENCE-SCHEMA — step 2: read-only collector.
 *
 * Aggregates the diagnostic globals the app already publishes into the normalized
 * `SttEvidence` schema (see sttEvidence.ts). READ-ONLY: it reads window globals, never
 * mutates state, transcripts, or behavior. Fields whose source global is absent (e.g. when
 * the Private transcript trace is off) are left UNSET so `buildSttEvidence` reports
 * `NOT_AVAILABLE` — we never invent a `0` that would trip an INVALID gate, and we never
 * infer PASS from an absent transcript.
 *
 * Globals consumed (per test harness-alignment):
 *   - window.__PRIVATE_TIMING__                  → load/first/decode/finalize timing, utteranceSeconds
 *   - window.__PRIVATE_STT_TIMELINE__            → process_audio_ready count, speech_start_detected
 *   - window.__PRIVATE_INFERENCE_AUDIO_CHUNKS__  → audioDelivered, rmsMax, peakMax (+ duration)
 *   - window.__PRIVATE_UTTERANCE_AUDIO_CHUNKS__  → audioDelivered, rmsMax, peakMax (+ duration)
 *   - window.__PRIVATE_MODEL_TELEMETRY__         → modelId, provider/runtime, modelLoadMs, source, fallback
 *   - window.__SPEECH_RUNTIME_DEBUG__()          → serviceMode, transcriptLength, saveCandidate.repetitionRisk
 *
 * Harness-only fields the app cannot know (fixtureId, referenceText/wer, saveMs,
 * detailHydrationMs, stopFinalizationMs, speechExpected, envValid, tier) are passed as
 * `overrides`, which take precedence over collected values.
 */
import { buildSttEvidence, type SttEvidence, type SttEvidenceInput } from './sttEvidence';

interface TimingLike {
    timeToFirstProvisionalMs?: number | null;
    timeToFirstFinalMs?: number | null;
    finalizeDecodeMs?: number | null;
    finalizeWaitMs?: number | null;
    utteranceSeconds?: number | null;
}
interface AudioChunkLike {
    durationSec?: number | null;
    rms?: number | null;
    peak?: number | null;
}
interface TimelineEventLike {
    event?: string;
}
interface ModelTelemetryLike {
    model?: string;
    runtime?: string;
    loadTimeMs?: number | null;
    fallbackPath?: string;
    cloudFallbackAttempted?: boolean;
}
interface SaveCandidateLike {
    selectedForSaveLength?: number;
    repetitionRisk?: boolean;
}
interface RuntimeDebugLike {
    serviceMode?: string | null;
    transcriptLength?: number;
    saveCandidate?: SaveCandidateLike | null;
}

/** The diagnostic globals, gathered into one object so collection is unit-testable without a DOM. */
export interface SttEvidenceSources {
    timing?: TimingLike | null;
    inferenceChunks?: AudioChunkLike[] | null;
    utteranceChunks?: AudioChunkLike[] | null;
    timeline?: TimelineEventLike[] | null;
    modelTelemetry?: ModelTelemetryLike | null;
    runtimeDebug?: RuntimeDebugLike | null;
}

declare global {
    interface Window {
        // __PRIVATE_MODEL_TELEMETRY__ and __SPEECH_RUNTIME_DEBUG__ are already declared by
        // privateModelFlag.ts / SpeechRuntimeController.ts; we only add the new accessor here.
        /** Read-only STT evidence snapshot for proof harnesses (installed by the controller). */
        __STT_EVIDENCE__?: (overrides?: Partial<SttEvidenceInput>) => SttEvidence;
    }
}

function isFiniteNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

/** Max of the finite values across the given chunk arrays for one key; undefined if none present. */
function maxChunkValue(arrays: Array<AudioChunkLike[] | null | undefined>, key: 'rms' | 'peak'): number | undefined {
    let max: number | undefined;
    for (const arr of arrays) {
        if (!Array.isArray(arr)) continue;
        for (const chunk of arr) {
            const v = chunk?.[key];
            if (isFiniteNumber(v)) max = max === undefined ? v : Math.max(max, v);
        }
    }
    return max;
}

/** Read the diagnostic globals off `window` (defensively). Safe when window/globals are absent. */
export function readSttEvidenceSources(win: Window | undefined = typeof window !== 'undefined' ? window : undefined): SttEvidenceSources {
    if (!win) return {};
    let runtimeDebug: RuntimeDebugLike | null = null;
    try {
        runtimeDebug = typeof win.__SPEECH_RUNTIME_DEBUG__ === 'function'
            ? (win.__SPEECH_RUNTIME_DEBUG__() as RuntimeDebugLike)
            : null;
    } catch {
        runtimeDebug = null;
    }
    return {
        timing: (win.__PRIVATE_TIMING__ as TimingLike | undefined) ?? null,
        inferenceChunks: (win.__PRIVATE_INFERENCE_AUDIO_CHUNKS__ as AudioChunkLike[] | undefined) ?? null,
        utteranceChunks: (win.__PRIVATE_UTTERANCE_AUDIO_CHUNKS__ as AudioChunkLike[] | undefined) ?? null,
        timeline: (win.__PRIVATE_STT_TIMELINE__ as TimelineEventLike[] | undefined) ?? null,
        modelTelemetry: (win.__PRIVATE_MODEL_TELEMETRY__ as ModelTelemetryLike | undefined) ?? null,
        runtimeDebug,
    };
}

/**
 * Map the raw diagnostic sources into an `SttEvidenceInput` and normalize via `buildSttEvidence`.
 * A field is only set when its source global is actually present, so trace-off runs report
 * `NOT_AVAILABLE` rather than a fabricated value. `overrides` (harness-only fields) win.
 */
export function collectSttEvidence(sources: SttEvidenceSources, overrides: Partial<SttEvidenceInput> = {}): SttEvidence {
    const input: SttEvidenceInput = { tier: 'app-lifecycle' };

    const { timing, modelTelemetry: model, runtimeDebug: dbg, timeline, inferenceChunks, utteranceChunks } = sources;

    // --- engine / selection ---
    if (model?.runtime != null || dbg?.serviceMode != null) input.provider = dbg?.serviceMode ?? model?.runtime ?? undefined;
    if (model?.model != null) input.modelId = model.model;
    if (model?.fallbackPath === 'remote-only') input.modelSource = 'remote';
    else if (model?.fallbackPath === 'local-then-remote') input.modelSource = 'local';
    if (typeof model?.cloudFallbackAttempted === 'boolean') input.fallbackOccurred = model.cloudFallbackAttempted;

    // --- timing (kept separate) ---
    if (model && model.loadTimeMs != null) input.modelLoadMs = model.loadTimeMs ?? undefined;
    if (timing) {
        const firstText = timing.timeToFirstProvisionalMs ?? timing.timeToFirstFinalMs;
        if (firstText != null) input.firstTextMs = firstText;
        if (timing.finalizeDecodeMs != null) input.decodeMs = timing.finalizeDecodeMs;
        if (timing.finalizeWaitMs != null) input.finalizeMs = timing.finalizeWaitMs;
        if (timing.utteranceSeconds != null) input.audioDurationSec = timing.utteranceSeconds;
    }

    // --- audio validity (only when the trace globals exist) ---
    if (Array.isArray(timeline)) {
        input.processAudioReadyCount = timeline.filter((e) => e?.event === 'process_audio_ready').length;
        input.speechDetected = timeline.some((e) => e?.event === 'speech_start_detected');
    }
    if (Array.isArray(inferenceChunks) || Array.isArray(utteranceChunks)) {
        const total = (inferenceChunks?.length ?? 0) + (utteranceChunks?.length ?? 0);
        input.audioDelivered = total > 0;
        const rms = maxChunkValue([inferenceChunks, utteranceChunks], 'rms');
        const peak = maxChunkValue([inferenceChunks, utteranceChunks], 'peak');
        if (rms !== undefined) input.rmsMax = rms;
        if (peak !== undefined) input.peakMax = peak;
        // Fallback audio duration from chunk sums when timing did not provide it.
        if (input.audioDurationSec === undefined) {
            let sec = 0;
            let any = false;
            for (const arr of [inferenceChunks, utteranceChunks]) {
                if (!Array.isArray(arr)) continue;
                for (const c of arr) if (isFiniteNumber(c?.durationSec)) { sec += c.durationSec as number; any = true; }
            }
            if (any) input.audioDurationSec = Number(sec.toFixed(3));
        }
    }

    // --- output ---
    const transcriptLength = dbg?.saveCandidate?.selectedForSaveLength ?? dbg?.transcriptLength;
    if (isFiniteNumber(transcriptLength)) input.transcriptLength = transcriptLength;
    if (typeof dbg?.saveCandidate?.repetitionRisk === 'boolean') input.repetitionRisk = dbg.saveCandidate.repetitionRisk;

    // Harness-only fields override anything collected.
    return buildSttEvidence({ ...input, ...overrides });
}

/** Convenience: collect from the live `window` globals. */
export function collectSttEvidenceFromWindow(overrides?: Partial<SttEvidenceInput>): SttEvidence {
    return collectSttEvidence(readSttEvidenceSources(), overrides);
}

/** Install the read-only `window.__STT_EVIDENCE__()` accessor for proof harnesses. */
export function installSttEvidenceCollector(win: Window | undefined = typeof window !== 'undefined' ? window : undefined): void {
    if (!win) return;
    win.__STT_EVIDENCE__ = (overrides?: Partial<SttEvidenceInput>) => collectSttEvidenceFromWindow(overrides);
}
