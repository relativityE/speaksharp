import { useCallback } from 'react';
import { TranscriptionPolicy } from '../../services/transcription/TranscriptionPolicy';
import logger from '../../lib/logger';
import { speechRuntimeController } from '../../services/SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';

/**
 * Atomic Hook: Controls the transcription lifecycle.
 * Responsibility: Start, Stop, and Pause logic.
 * 
 * Industry Pattern: Controller Pattern (React version)
 */
export const useTranscriptionControl = () => {
    const isReady = useSessionStore(s => s.isReady);

    const startListening = useCallback(async (policy?: TranscriptionPolicy) => {
        logger.debug('[useTranscriptionControl] startListening triggered (Zero-Wait UX)');
        logger.info('[useTranscriptionControl] Starting transcription via Controller');
        await speechRuntimeController.startRecording(policy);
    }, []);

    const stopListening = useCallback(async () => {
        logger.info('[useTranscriptionControl] Stopping transcription via Controller');
        return await speechRuntimeController.stopRecording();
    }, []);

    return {
        startListening,
        stopListening,
        isServiceReady: isReady
    };
};
