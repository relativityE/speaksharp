import { EngineType } from './IPrivateSTTEngine';
import { TranscriptionModeOptions, Result } from '../services/transcription/modes/types';
import { AvailabilityResult } from '../services/transcription/STTStrategy';

export interface PrivateSTTInitOptions extends TranscriptionModeOptions {
    forceEngine?: EngineType;
    useWebGpu?: boolean;
}

export interface IPrivateSTT {
    checkAvailability(): Promise<AvailabilityResult>;
    init(timeoutMs?: number): Promise<Result<void, Error>>;

    /**
     * Start the underlying engine
     */
    start(): Promise<void>;

    /**
     * Stop the underlying engine
     */
    stop(): Promise<void>;

    transcribe(audio: Float32Array): Promise<Result<string, Error>>;

    /**
     * SEGMENTED FINALIZATION (#891): decode ONE closed segment -> text + per-word timings. OPTIONAL —
     * delegates to the active engine's `transcribeSegment` when present (word-timestamp-capable engines
     * only); callers feature-detect. Background/best-effort: failure is non-fatal by contract.
     */
    transcribeSegment?(audio: Float32Array): Promise<Result<import('../services/transcription/utils/seamReconciliation').SegmentTranscription, Error>>;

    destroy(): Promise<void>;
    getEngineType(): string;
    /**
     * Get the last heartbeat timestamp from the active engine
     */
    getLastHeartbeatTimestamp(): number;
}
