import { createContext } from 'react';
import TranscriptionService from '../services/transcription/TranscriptionService';
import { RuntimeState } from '../services/SpeechRuntimeController';

export interface TranscriptionContextValue {
    service: TranscriptionService | null;
    isReady: boolean;
    runtimeState: RuntimeState;
}

export const TranscriptionContext = createContext<TranscriptionContextValue | null>(null);
