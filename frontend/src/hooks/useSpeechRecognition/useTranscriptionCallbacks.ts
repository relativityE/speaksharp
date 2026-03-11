import { useEffect, useRef } from 'react';
import { useTranscriptionContext } from '@/providers/useTranscriptionContext';
import { TranscriptionServiceOptions } from '../../services/transcription/TranscriptionService';

/**
 * Atomic Hook: Callback Synchronization.
 * Responsibility: Re-hydrating the TranscriptionService singleton with fresh React callbacks.
 *
 * DESIGN: Uses "Lately Captured State" pattern via useRef to ensure the Service
 * always has access to the freshest callbacks without re-triggering effects on every render.
 */
export function useTranscriptionCallbacks(callbacks: Partial<TranscriptionServiceOptions>) {
    const { service, isReady } = useTranscriptionContext();
    const callbacksRef = useRef(callbacks);

    // Sync ref synchronously on every render
    callbacksRef.current = callbacks;

    useEffect(() => {
        if (!service || !isReady) return;

        // Re-synchronize service with latest callbacks
        service.updateCallbacks(callbacksRef.current);
    }, [service, isReady]); // Only re-run if service instance or readiness changes

}
