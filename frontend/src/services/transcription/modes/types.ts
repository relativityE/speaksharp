import { Session } from '@supabase/supabase-js';
import { NavigateFunction } from 'react-router-dom';
import { MicStream } from '../utils/types';
import { SttStatus } from '@/types/transcription';
import { TranscriptionMode } from '../TranscriptionPolicy';

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
    public readonly code: 'NETWORK' | 'PERMISSION' | 'MODEL_LOAD' | 'WEBSOCKET' | 'UNKNOWN',
    public readonly recoverable: boolean
  ) {
    super(message);
    this.name = 'TranscriptionError';
  }

  /**
   * Factory for network-related errors (WebSocket, API calls)
   */
  static network(message: string, recoverable = true): TranscriptionError {
    return new TranscriptionError(message, 'NETWORK', recoverable);
  }

  /**
   * Factory for microphone permission errors
   */
  static permission(message: string): TranscriptionError {
    return new TranscriptionError(message, 'PERMISSION', false);
  }

  /**
   * Factory for model loading errors (OnDeviceWhisper)
   */
  static modelLoad(message: string): TranscriptionError {
    return new TranscriptionError(message, 'MODEL_LOAD', true);
  }

  /**
   * Factory for WebSocket-specific errors
   */
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
  /** Callback for raw audio data (for visualization/analysis) */
  onAudioData?: (data: Float32Array) => void;
  onModeChange?: (mode: TranscriptionMode | null) => void;
  onStatusChange?: (status: SttStatus) => void;
  /** Unique identifier for the engine instance (used for diagnostic tracing) */
  instanceId?: string;
  /** Unique identifier for the service instance */
  serviceId?: string;
}

export interface ITranscriptionEngine {
  init(): Promise<void>;
  startTranscription(mic?: MicStream): Promise<void>;
  stopTranscription(): Promise<string>;
  dispose(): void;
  getTranscript(): Promise<string>;
  getEngineType(): string;

  /**
   * Returns the timestamp (ms) of the last successful activity (e.g., frame processed).
   * Used for 8s heartbeat watchdog.
   * NEW — must be required
   */
  getLastHeartbeatTimestamp(): number;
  
  onReady?: () => void;
  instanceId?: string;
  terminate?(): Promise<void>;
}
