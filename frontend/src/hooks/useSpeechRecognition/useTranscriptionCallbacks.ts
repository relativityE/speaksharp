import { useEffect, useRef } from 'react';
import { useTranscriptionContext } from '@/providers/useTranscriptionContext';
import { speechRuntimeController } from '../../services/SpeechRuntimeController';
import { TranscriptUpdate, SttStatus } from '@/types/transcription';
import type { Session } from '@supabase/supabase-js';
import type { NavigateFunction } from 'react-router-dom';
import logger from '@/lib/logger';

/**
 * Atomic Hook: Callback Synchronization.
 * Responsibility: Registering UI callbacks with the SpeechRuntimeController.
 * This ensures they are proxied correctly and play nice with the Segmented Emission Queue.
 */
import type { TranscriptionPolicy, TranscriptionMode } from '../../services/transcription/TranscriptionPolicy';

interface TranscriptionCallbacks {
    onTranscriptUpdate?: (data: TranscriptUpdate) => void;
    onAudioData?: (data: Float32Array) => void;
    getAssemblyAIToken?: () => Promise<string | null>;
    session?: Session | null; 
    navigate?: NavigateFunction;
    userWords?: string[];
    policy?: TranscriptionPolicy;
    onReady?: () => void;
    onError?: (err: Error) => void;
    onModelLoadProgress?: (p: number | null) => void;
    onStatusChange?: (s: SttStatus) => void;
    onModeChange?: (m: TranscriptionMode | null) => void;
}

export function useTranscriptionCallbacks(callbacks: TranscriptionCallbacks) {
    const { isReady } = useTranscriptionContext();
    const callbacksRef = useRef(callbacks);

    // Keep latest callbacks in ref to avoid stale closures
    useEffect(() => {
        callbacksRef.current = callbacks;
    });

    useEffect(() => {
        if (!isReady) return;

        speechRuntimeController.setSubscriberCallbacks({
            onTranscriptUpdate: (update) => {
                logger.debug({ 
                    isFinal: !!update.transcript?.final,
                    text: update.transcript?.final || update.transcript?.partial 
                }, '[useTranscriptionCallbacks] 🎣 Hook receiving transcript from Service');
                callbacksRef.current.onTranscriptUpdate?.(update);
            },
            onModelLoadProgress: (progress) => callbacksRef.current.onModelLoadProgress?.(progress),
            onReady: () => callbacksRef.current.onReady?.(),
            onModeChange: (mode) => callbacksRef.current.onModeChange?.(mode),
            onStatusChange: (status) => callbacksRef.current.onStatusChange?.(status),
            onAudioData: (data) => callbacksRef.current.onAudioData?.(data),
            onError: (err) => callbacksRef.current.onError?.(err),
            session: callbacksRef.current.session ?? undefined,
            navigate: callbacksRef.current.navigate as unknown as NavigateFunction,
            getAssemblyAIToken: callbacksRef.current.getAssemblyAIToken,
            userWords: callbacksRef.current.userWords,
        });

        return () => {
            // Symmetrically detaches callback listeners from the controller upon unmount 
            // to prevent memory leaks and orphaned event emissions during React remount cycles.
            void speechRuntimeController.reset('subscriber_unmount');
        };
    }, [isReady]);
}
