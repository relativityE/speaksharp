import { createContext } from 'react';

import { RuntimeState } from '../services/SpeechRuntimeController';

import { useSessionStore } from '@/stores/useSessionStore';

export interface TranscriptionContextValue {
    isReady: boolean;
    runtimeState: RuntimeState;
    useStore: typeof useSessionStore; // Authoritative store instance
}

export const TranscriptionContext = createContext<TranscriptionContextValue | null>(null);
