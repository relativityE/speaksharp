/**
 * ============================================================================
 * PRIVATE STT ENGINE INTERFACE
 * ============================================================================
 * 
 * Abstraction layer for on-device speech-to-text engines.
 * Enables dual-engine architecture: whisper-turbo (fast) + transformers.js (safe)
 * 
 * @see docs/ARCHITECTURE.md - "Dual-Engine Private STT"
 */

import { Result } from '@/services/transcription/modes/types';

/**
 * Engine type identifier
 */
export type EngineType = 'whisper-turbo' | 'transformers-js' | 'mock' | 'native' | 'cloud' | 'native-browser' | 'assemblyai';

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
 * Both whisper-turbo and transformers.js adapters implement this.
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

    init(timeoutMs?: number): Promise<Result<void, Error>>;
    
    /**
     * Start the engine (Contract Requirement)
     */
    start(mic?: import('@/services/transcription/utils/types').MicStream): Promise<void>;

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
