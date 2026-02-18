import { createContext } from 'react';
import TranscriptionService from '../services/transcription/TranscriptionService';

export interface TranscriptionContextValue {
    service: TranscriptionService | null;
    isReady: boolean;
}

export const TranscriptionContext = createContext<TranscriptionContextValue | null>(null);
