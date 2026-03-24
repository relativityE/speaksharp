import { createContext } from 'react';

import { RuntimeState } from '../services/SpeechRuntimeController';

export interface TranscriptionContextValue {
    isReady: boolean;
    runtimeState: RuntimeState;
}

export const TranscriptionContext = createContext<TranscriptionContextValue | null>(null);
