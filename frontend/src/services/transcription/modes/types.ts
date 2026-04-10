import { Session } from '@supabase/supabase-js';
import { NavigateFunction } from 'react-router-dom';
// Unused import removed
import { SttStatus } from '../../../types/transcription';
import { TranscriptionMode } from '../TranscriptionPolicy';
import { STTStrategy } from '../STTStrategy';
import { TranscriptionError } from '../errors';

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

// TranscriptionError definition removed (Moved to consolidated errors.ts)

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



export interface ITranscriptionEngine extends STTStrategy {
  init(timeoutMs?: number): Promise<Result<void, Error>>;
  
  // These are now inherited from STTStrategy, but we can override or specialize if needed.
  // The base STTStrategy covers start, stop, terminate, getTranscript, getLastHeartbeatTimestamp, getEngineType.
  
  onReady?: () => void;
  instanceId?: string;
}

export { TranscriptionMode };
