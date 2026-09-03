/**
 * ============================================================================
 * PRIVATE STT ENGINE INTERFACE
 * ============================================================================
 * 
 * Abstraction layer for on-device speech-to-text engines.
 * On-device engines: transformers.js (v2 CPU, default) + transformers.js v4 (experimental).
 * (whisper-turbo / WebGPU was retired pre-beta.)
 *
 * @see docs/ARCHITECTURE.md - "Private STT"
 */

import { Result } from '@/services/transcription/modes/types';

/**
 * Engine type identifier
 */
export type EngineType = 'transformers-js' | 'transformers-js-v4' | 'moonshine-streaming' | 'mock' | 'native' | 'cloud' | 'native-browser' | 'assemblyai' | 'deepgram';

/**
 * Callbacks for engine lifecycle events
 */
export interface EngineCallbacks {
    onModelLoadProgress?: (progress: number) => void;
    onReady?: () => void;
    // Correlation IDs for Triple-Identity Tracing
    serviceId?: string;
    runId?: string;
}

/**
 * Interface for Private STT engines.
 * The transformers.js adapters (v2 + v4) implement this.
 */
/**
 * #1405s — what a LIVE result from this engine MEANS.
 *
 * `incremental` (the default): each live result is the newly decoded segment. The facade accumulates
 * them, which is how v2/v4 build a growing draft.
 *
 * `snapshot`: each live result is the COMPLETE transcript so far. Accumulating those duplicates text —
 * and worse, a snapshot that REVISES an earlier word shares no boundary with the previous one, so
 * overlap trimming finds nothing and the whole snapshot is appended:
 *   "hello word" + "hello world again" -> "hello word hello world again".
 * A snapshot replaces the visible draft; it is never appended to it.
 *
 * Declared by the engine rather than inferred from its name, so a future snapshot engine cannot inherit
 * incremental handling by default and silently reintroduce this.
 */
export type LiveResultKind = 'incremental' | 'snapshot';

export interface IPrivateSTTEngine {
    /**
     * Engine type identifier
     */
    readonly type: EngineType;

    /**
     * How to interpret this engine's LIVE results. Absent means `incremental`, which is the historical
     * behaviour every existing engine relies on.
     */
    readonly liveResultKind?: LiveResultKind;

    /**
     * Probe availability and prerequisites (Contract Requirement)
     */
    checkAvailability(): Promise<import('@/services/transcription/STTStrategy').AvailabilityResult>;

    init(timeoutMs?: number, isMock?: boolean): Promise<Result<void, Error>>;
    
    /**
     * Start the engine (Contract Requirement)
     */
    start(mic?: import('@/services/transcription/utils/types').MicStream, userWords?: string[]): Promise<void>;

    /**
     * Stop the engine (Contract Requirement)
     */
    stop(): Promise<void>;

    /**
     * Pause the engine
     */
    pause(): Promise<void>;

    /**
     * Resume the engine
     */
    resume(): Promise<void>;

    /**
     * Transcribe audio data
     * @param audio - Raw audio samples (Float32Array)
     * @returns Transcribed transcript
     */
    /**
     * @param options.final TRUE only for the stop-commit decode.
     *
     * A STREAMING ENGINE CANNOT INFER THIS. `PrivateWhisper` calls `transcribe` on a timer during
     * recording AND once at stop; to the engine both look identical. An engine that guessed "a live
     * session means finalize" closed its stream on the FIRST live decode and dropped the rest of the
     * user's speech. The caller knows which one it is -- `processAudio({ force: true })` is the commit
     * -- so it says so.
     */
    transcribe(audio: Float32Array, options?: { final?: boolean }): Promise<Result<string, Error>>;

    /**
     * Clean up resources
     */
    destroy(): Promise<void>;

    /**
     * Forcefully terminate engines and workers
     */
    terminate(): Promise<void>;

    /**
     * Update engine options at runtime
     */
    updateOptions(options: Partial<import('@/services/transcription/modes/types').TranscriptionModeOptions>): void;

    /** Unique identifier for tracing */
    instanceId?: string;

    /**
     * Get the last heartbeat timestamp (ms)
     */
    getLastHeartbeatTimestamp(): number;
}
