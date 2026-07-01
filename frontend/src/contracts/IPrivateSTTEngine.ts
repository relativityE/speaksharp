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
export type EngineType = 'transformers-js' | 'transformers-js-v4' | 'mock' | 'native' | 'cloud' | 'native-browser' | 'assemblyai' | 'deepgram';

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
export interface IPrivateSTTEngine {
    /**
     * Engine type identifier
     */
    readonly type: EngineType;

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
    transcribe(audio: Float32Array): Promise<Result<string, Error>>;

    /**
     * SEGMENTED FINALIZATION (#891): decode ONE closed segment, returning transcript text PLUS per-word
     * timings (the seam reconciler's input). OPTIONAL — only word-timestamp-capable engines
     * (transformers-js v2/v4) implement it; callers must feature-detect. Never mutates the canonical
     * whole-utterance buffer; failure is non-fatal (caller treats the segment as unconfirmed).
     */
    transcribeSegment?(audio: Float32Array): Promise<Result<import('@/services/transcription/utils/seamReconciliation').SegmentTranscription, Error>>;

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
