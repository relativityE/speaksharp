import { Session } from '@supabase/supabase-js';
import { NavigateFunction } from 'react-router-dom';
import { MicStream } from '../utils/types';

export interface Transcript {
  partial?: string;
  final?: string;
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
  customVocabulary?: string[];
  onConnectionStateChange?: (state: 'connected' | 'reconnecting' | 'disconnected' | 'error') => void;
}

export interface ITranscriptionMode {
  init(): Promise<void>;
  startTranscription(mic?: MicStream): Promise<void>; // mic is optional for native
  stopTranscription(): Promise<string>;
  getTranscript(): Promise<string>;
}
