import { useEffect } from 'react';
import { useTranscriptionContext } from '@/providers/useTranscriptionContext';
import { TranscriptionServiceOptions } from '../../services/transcription/TranscriptionService';

/**
 * Atomic Hook: Callback Synchronization.
 * Responsibility: Re-hydrating the TranscriptionService singleton with fresh React callbacks.
 */
export function useTranscriptionCallbacks(callbacks: Partial<TranscriptionServiceOptions>) {
    const { service, isReady } = useTranscriptionContext();

    useEffect(() => {
        if (!service || !isReady) return;

        service.updateCallbacks(callbacks);
    }, [service, isReady, callbacks]);

    // 🔴 TD-020 Cleanup: Ensure service is destroyed on unmount to free resources
    useEffect(() => {
        return () => {
            if (service) service.destroy();
        };
    }, [service]);
}
