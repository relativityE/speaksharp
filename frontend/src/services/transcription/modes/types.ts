import { Session } from '@supabase/supabase-js';
import { NavigateFunction } from 'react-router-dom';
// Unused import removed
import { SttStatus } from '@/types/transcription';
import { TranscriptionMode } from '../TranscriptionPolicy';
import { STTStrategy } from '../STTStrategy';

export type Result<T, E = Error> = { isOk: true; data: T } | { isOk: false; error: E };

export const Result = {
  ok: <T>(data: T): Result<T, never> => ({ isOk: true, data }),
  err: <E>(error: E): Result<never, E> => ({ isOk: false, error })
};

export interface Transcript {
  partial?: string;
  final?: string;
  speaker?: string;
}

/**
 * Unified error class for all transcription modes.
 * Enables consistent error handling, logging, and recovery strategies.
 */
export class TranscriptionError extends Error {
  constructor(
    message: string,
    public readonly code: 'NETWORK' | 'PERMISSION' | 'MODEL_LOAD' | 'WEBSOCKET' | 'UNKNOWN' | 'CACHE_MISS' | 'NO_API_KEY' | 'OFFLINE' | 'PERMISSION_DENIED' | 'UNSUPPORTED',
    public readonly recoverable: boolean
  ) {
    super(message);
    this.name = 'TranscriptionError';
  }

  static network(message: string, recoverable = true): TranscriptionError {
    return new TranscriptionError(message, 'NETWORK', recoverable);
  }

  static permission(message: string): TranscriptionError {
    return new TranscriptionError(message, 'PERMISSION', false);
  }

  static modelLoad(message: string): TranscriptionError {
    return new TranscriptionError(message, 'MODEL_LOAD', true);
  }

  static websocket(message: string, recoverable = true): TranscriptionError {
    return new TranscriptionError(message, 'WEBSOCKET', recoverable);
  }
}

export interface TranscriptionModeOptions {
  onTranscriptUpdate: (update: { transcript: Transcript }) => void;
  onModelLoadProgress?: (progress: number | null) => void;
  onReady: () => void;
  onError?: (error: TranscriptionError) => void;
  session?: Session | null;
  navigate?: NavigateFunction;
  getAssemblyAIToken?: () => Promise<string | null>;
  userWords?: string[];
  onConnectionStateChange?: (state: 'connected' | 'reconnecting' | 'disconnected' | 'error') => void;
  onAudioData?: (data: Float32Array) => void;
  onModeChange?: (mode: TranscriptionMode | null) => void;
  onStatusChange?: (status: SttStatus) => void;
  instanceId?: string;
  serviceId?: string;
  runId?: string;
}

export type InitResult = 
  | { status: 'ready' }
  | { status: 'requires_download'; sizeMB?: number }
  | void;

export interface ITranscriptionEngine extends STTStrategy {
  init(callbacks: TranscriptionModeOptions): Promise<InitResult | Result<void, Error>>;
  
  // These are now inherited from STTStrategy, but we can override or specialize if needed.
  // The base STTStrategy covers start, stop, terminate, getTranscript, getLastHeartbeatTimestamp, getEngineType.
  
  dispose(): void;
  onReady?: () => void;
  instanceId?: string;
}

export { TranscriptionMode };
