import { TranscriptionMode } from '../TranscriptionPolicy';
import { TranscriptUpdate, SttStatus } from '@/types/transcription';
import { MicStream } from '../utils/types';

/**
 * Runtime States for the Speech Runtime Controller
 */
export type SpeechRuntimeState =
    | 'UNINITIALIZED'
    | 'MODEL_CHECK'
    | 'MODEL_DOWNLOADING'
    | 'MODEL_LOADING'
    | 'MODEL_WARMING'
    | 'READY'
    | 'RECORDING'
    | 'PAUSED'
    | 'ERROR'
    | 'CLEANING_UP';

/**
 * Engine types supported by the runtime
 */
export type EngineType = 'private' | 'native' | 'cloud' | 'mock';

/**
 * Interface for Engine Adapters
 */
export interface IEngineAdapter {
    readonly type: EngineType;
    initialize(): Promise<void>;
    start(mic: MicStream): Promise<void>;
    stop(): Promise<string>;
    dispose(): Promise<void>;
    getTranscript(): string;
}

/**
 * Structured events emitted by the runtime
 */
export type SpeechRuntimeEvent =
    | { type: 'model_download_started'; mode: TranscriptionMode }
    | { type: 'model_download_progress'; mode: TranscriptionMode; progress: number }
    | { type: 'model_ready'; mode: TranscriptionMode }
    | { type: 'engine_activated'; mode: TranscriptionMode }
    | { type: 'engine_fallback'; from: TranscriptionMode; to: TranscriptionMode; reason: string }
    | { type: 'error'; error: Error };

/**
 * Configuration for the Speech Runtime Controller
 */
export interface SpeechRuntimeConfig {
    onStateChange: (state: SpeechRuntimeState) => void;
    onStatusChange: (status: SttStatus) => void;
    onTranscriptUpdate: (update: TranscriptUpdate) => void;
    onEvent: (event: SpeechRuntimeEvent) => void;
}
