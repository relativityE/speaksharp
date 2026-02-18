import React, { useEffect, useState } from 'react';
import TranscriptionService from '../services/transcription/TranscriptionService';
import { TranscriptionPolicy } from '../services/transcription/TranscriptionPolicy'; // Import the type
import logger from '../lib/logger';

import { TranscriptionContext } from './TranscriptionContext';

export const TranscriptionProvider: React.FC<{
    children: React.ReactNode;
    policy?: TranscriptionPolicy; // Optional policy
}> = ({ children, policy }) => {
    const [service, setService] = useState<TranscriptionService | null>(null);
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        logger.info('[TranscriptionProvider] Initializing global service singleton');
        // Instantiate with optional policy
        const svc = new TranscriptionService(policy ? { policy } : {});
        setService(svc);
        setIsReady(true);

        return () => {
            logger.info('[TranscriptionProvider] Unmounting, destroying service');
            svc.destroy().catch(err => {
                logger.error({ err }, '[TranscriptionProvider] Error destroying service');
            });
        };
    }, [policy]); // Re-create if policy prop changes strongly (usually it shouldn't)

    return (
        <TranscriptionContext.Provider value={{ service, isReady }}>
            {children}
        </TranscriptionContext.Provider>
    );
};
