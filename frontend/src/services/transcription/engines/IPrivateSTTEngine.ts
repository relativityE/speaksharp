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

import { Result } from 'true-myth';

/**
 * Engine type identifier
 */
export type EngineType = 'whisper-turbo' | 'transformers-js' | 'mock';

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
     * Initialize the engine (download model, compile WASM, etc.)
     * @param callbacks - Lifecycle callbacks
     * @param timeoutMs - Maximum time to wait for initialization
     * @returns Result indicating success or failure
     */
    init(callbacks: EngineCallbacks, timeoutMs?: number): Promise<Result<void, Error>>;

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
    terminate?(): Promise<void>;

    /** Unique identifier for tracing */
    instanceId?: string;
}
