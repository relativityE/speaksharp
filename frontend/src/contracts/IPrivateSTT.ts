import { EngineType } from './IPrivateSTTEngine';
import { TranscriptionModeOptions, Result } from '../services/transcription/modes/types';

export interface PrivateSTTInitOptions extends TranscriptionModeOptions {
    forceEngine?: EngineType;
    useWebGpu?: boolean;
}

export interface IPrivateSTT {
    init(options: PrivateSTTInitOptions): Promise<Result<EngineType, Error>>;

    /**
     * Start the underlying engine
     */
    start(): Promise<void>;

    /**
     * Stop the underlying engine
     */
    stop(): Promise<void>;

    transcribe(audio: Float32Array): Promise<Result<string, Error>>;
    destroy(): Promise<void>;
    getEngineType(): EngineType | null;
    /**
     * Get the last heartbeat timestamp from the active engine
     */
    getLastHeartbeatTimestamp(): number;
}
