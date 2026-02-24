import { useEffect, useRef } from 'react';
import { useTranscriptionContext } from '@/providers/useTranscriptionContext';
import { TranscriptionServiceOptions } from '../../services/transcription/TranscriptionService';

/**
 * Atomic Hook: Callback Synchronization.
 * Responsibility: Re-hydrating the TranscriptionService singleton with fresh React callbacks.
 */
export function useTranscriptionCallbacks(callbacks: Partial<TranscriptionServiceOptions>) {
    const { service, isReady } = useTranscriptionContext();
    const callbacksRef = useRef(callbacks);

    // Keep latest callbacks in ref to avoid stale closures
    useEffect(() => {
        callbacksRef.current = callbacks;
    });

    useEffect(() => {
        if (!service || !isReady) return;

        // Note: we use arrow functions that point to the ref
        // so that the service doesn't need to be updated on every render.
        // HOWEVER, TranscriptionService Facade has an updateCallbacks method
        // which we can call explicitly to ensure it has the latest.

        service.updateCallbacks({
            onTranscriptUpdate: (update) => callbacksRef.current.onTranscriptUpdate?.(update),
            onModelLoadProgress: (progress) => callbacksRef.current.onModelLoadProgress?.(progress),
            onReady: () => callbacksRef.current.onReady?.(),
            onModeChange: (mode) => callbacksRef.current.onModeChange?.(mode),
            onStatusChange: (status) => callbacksRef.current.onStatusChange?.(status),
            onAudioData: (data) => callbacksRef.current.onAudioData?.(data),
            onError: (err) => callbacksRef.current.onError?.(err),
            session: callbacksRef.current.session,
            navigate: callbacksRef.current.navigate,
            getAssemblyAIToken: callbacksRef.current.getAssemblyAIToken,
            userWords: callbacksRef.current.userWords,
        });

    }, [service, isReady]);
}
