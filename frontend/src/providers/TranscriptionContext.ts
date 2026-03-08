import { createContext } from 'react';
import TranscriptionService from '../services/transcription/TranscriptionService';
import { SpeechRuntimeController } from '../services/transcription/runtime/SpeechRuntimeController';

export interface TranscriptionContextValue {
    service: TranscriptionService | null;
    runtime: SpeechRuntimeController | null;
    isReady: boolean;
}

export const TranscriptionContext = createContext<TranscriptionContextValue | null>(null);
