import { Session } from '@supabase/supabase-js';
import { NavigateFunction } from 'react-router-dom';
import { MicStream } from '../utils/types';

export interface Transcript {
  partial?: string;
  final?: string;
}

export interface TranscriptionModeOptions {
  onTranscriptUpdate: (update: { transcript: Transcript }) => void;
  onModelLoadProgress?: (progress: number) => void;
  onReady: () => void;
  session?: Session | null;
  navigate?: NavigateFunction;
  getAssemblyAIToken?: () => Promise<string | null>;
}

export interface ITranscriptionMode {
  init(): Promise<void>;
  startTranscription(mic?: MicStream): Promise<void>; // mic is optional for native
  stopTranscription(): Promise<string>;
  getTranscript(): Promise<string>;
}
