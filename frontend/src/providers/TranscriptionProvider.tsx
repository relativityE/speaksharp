import React, { useEffect, useState } from 'react';
import { getTranscriptionService } from '../services/transcription/TranscriptionService';
import { TranscriptionPolicy } from '../services/transcription/TranscriptionPolicy'; // Import the type
import logger from '../lib/logger';

import { TranscriptionContext } from './TranscriptionContext';

export const TranscriptionProvider: React.FC<{
    children: React.ReactNode;
    policy?: TranscriptionPolicy; // Optional policy
}> = ({ children, policy }) => {
    // 1. Singleton Acquisition (Survives Remounts)
    const service = getTranscriptionService(policy ? { policy } : {});
    const [isReady, setIsReady] = useState(true);

    // 2. Lifecycle Audit: We no longer destroy the service on unmount 
    // because it is a global singleton protecting the WASM state.
    useEffect(() => {
        logger.info('[TranscriptionProvider] Component mounted/updated');
        return () => {
            logger.info('[TranscriptionProvider] Component unmounting (Service persists)');
        };
    }, []);

    return (
        <TranscriptionContext.Provider value={{ service, isReady }}>
            {children}
        </TranscriptionContext.Provider>
    );
};

