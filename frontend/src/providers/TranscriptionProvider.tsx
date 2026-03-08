import React, { useEffect, useMemo } from 'react';
import { getTranscriptionService, TranscriptionServiceOptions } from '../services/transcription/TranscriptionService';
import { TranscriptionModeOptions } from '../services/transcription/modes/types';
import { TranscriptionPolicy, PROD_FREE_POLICY } from '../services/transcription/TranscriptionPolicy'; // Import the type
import logger from '../lib/logger';
import { SpeechRuntimeController } from '../services/transcription/runtime/SpeechRuntimeController';
import {
    SpeechRuntimeState,
    SpeechRuntimeEvent
} from '../services/transcription/runtime/types';
import { SttStatus, TranscriptUpdate } from '@/types/transcription';
import { useSessionStore } from '../stores/useSessionStore';

import { TranscriptionContext } from './TranscriptionContext';

export const TranscriptionProvider: React.FC<{
    children: React.ReactNode;
    policy?: TranscriptionPolicy; // Optional policy
}> = ({ children, policy }) => {
    // 1. Singleton Acquisition (Survives Remounts)
    const service = getTranscriptionService(policy ? { policy } : {});

    // 2. Initialize Speech Runtime Controller (Layer 1 Orchestrator)
    const runtime = useMemo(() => {
        const config = {
            onStateChange: (state: SpeechRuntimeState) => logger.info(`[Runtime] State: ${state}`),
            onStatusChange: (status: SttStatus) => useSessionStore.getState().setSTTStatus(status),
            onTranscriptUpdate: (_update: TranscriptUpdate) => { /* handled by callbacks in service for now */ },
            onEvent: (event: SpeechRuntimeEvent) => logger.info({ event }, '[Runtime] Event'),
        };

        // We bridge the legacy options here for compatibility during migration
        const legacyOptions = (service as unknown as { options: TranscriptionServiceOptions }).options;

        return new SpeechRuntimeController(
            config,
            policy || service.getPolicy() || PROD_FREE_POLICY,
            legacyOptions as unknown as TranscriptionModeOptions
        );
    }, [service, policy]);

    const isReady = true;

    // 3. Lifecycle Audit: We no longer destroy the service on unmount
    // because it is a global singleton protecting the WASM state.
    useEffect(() => {
        logger.info('[TranscriptionProvider] Component mounted/updated');
        return () => {
            logger.info('[TranscriptionProvider] Component unmounting (Service persists)');
        };
    }, []);

    return (
        <TranscriptionContext.Provider value={{ service, runtime, isReady }}>
            {children}
        </TranscriptionContext.Provider>
    );
};

