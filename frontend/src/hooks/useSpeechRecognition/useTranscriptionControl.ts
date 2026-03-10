import { useCallback, useEffect } from 'react';
import { useTranscriptionContext } from '@/providers/useTranscriptionContext';
import { TranscriptionPolicy } from '../../services/transcription/TranscriptionPolicy';
import logger from '../../lib/logger';

/**
 * Atomic Hook: Controls the transcription lifecycle.
 * Responsibility: Start, Stop, and Pause logic.
 * 
 * Industry Pattern: Controller Pattern (React version)
 */
export const useTranscriptionControl = () => {
    const { service, isReady } = useTranscriptionContext();

    const startListening = useCallback(async (policy?: TranscriptionPolicy) => {
        if (!service || !isReady) {
            logger.warn('[useTranscriptionControl] Attempted to start before service was ready');
            return;
        }
        logger.info('[useTranscriptionControl] Starting transcription');
        await service.startTranscription(policy);
    }, [service, isReady]);

    const stopListening = useCallback(async () => {
        if (!service) return;
        logger.info('[useTranscriptionControl] Stopping transcription');
        return await service.stopTranscription();
    }, [service]);

    // Ensure cleanup happens on unmount
    useEffect(() => {
        return () => {
            if (service && typeof service.destroy === 'function') {
                logger.info('[useTranscriptionControl] Cleaning up service on unmount');
                service.destroy();
            }
        };
    }, [service]);

    return {
        startListening,
        stopListening,
        isServiceReady: isReady
    };
};
