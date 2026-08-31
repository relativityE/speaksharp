import type { CandidateId, SessionModelIdentity } from '../services/transcription/candidateRegistry';
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
    destroy(): Promise<void>;
    getEngineType(): string;
    /**
     * Durable engine identity for the saved session row and #1033 VERIFIED attribution:
     * `engineVersion` (resolved A/B arm), `modelName`, and on-device `deviceType`. The concrete
     * PrivateSTT engine already implements this; declaring it here lets the PrivateWhisper wrapper
     * delegate so `TranscriptionService.getMetadata()` (which asks the outer strategy) returns a
     * complete tuple instead of falling back to null → Private no longer records `unverified`.
     */
    getMetadata(): {
        engineVersion: string; modelName: string; deviceType: string;
        /** The RESOLVED candidate. Absent — never guessed — when the runtime state is unrecognised. */
        candidateId?: CandidateId;
        /** Configured provenance for that candidate, separate from observed execution facts. */
        modelIdentity?: SessionModelIdentity;
    };
    /**
     * Get the last heartbeat timestamp from the active engine
     */
    getLastHeartbeatTimestamp(): number;
}
