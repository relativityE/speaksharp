import { useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { calculateTranscriptStats } from '../../utils/fillerWordUtils';
import logger from '../../lib/logger';
import { useProfile } from '../useProfile';
import { toast } from '@/lib/toast';
import { checkRateLimit } from '../../lib/rateLimiter';

import { useTranscriptionState } from './useTranscriptionState';
import { useFillerWords } from './useFillerWords';
import { useTranscriptionControl } from './useTranscriptionControl';
import { useTranscriptionCallbacks } from './useTranscriptionCallbacks';
import { useVocalAnalysis } from '../useVocalAnalysis';
import { API_CONFIG } from '../../config';
import type { UseSpeechRecognitionProps, TranscriptStats, TranscriptionPolicy, Chunk } from './types';
import type { SttStatus } from '@/types/transcription';
import { E2E_DETERMINISTIC_NATIVE, buildPolicyForUser } from './types';
import type { FillerCounts } from '../../utils/fillerWordUtils';
import { useSessionStore } from '../../stores/useSessionStore';
import { speechRuntimeController } from '../../services/SpeechRuntimeController';

// Error handling helper
function handleTranscriptionError(err: Error) {
    logger.error({ err }, 'Transcription Error');
    toast.error(err.message, { id: 'stt-error-toast', duration: 5000 });
}

/**
 * Orchestrator Hook: useSpeechRecognition (Production)
 * Following "Strangler Fig" Pattern: Compose atomic hooks into a unified public API.
 * 
 * Responsibility: Coordinating lifecycle, state, and specialized services (VocalAnalysis, SessionTimer).
 */
export const useSpeechRecognition_prod = (props: UseSpeechRecognitionProps = {}) => {
    const userWords = useMemo(() => props.userWords || [], [props.userWords]);
    const userVocabulary = useMemo(() => props.userVocabulary || [], [props.userVocabulary]);
    const { session } = props;
    const { profile } = useProfile();
    const navigate = useNavigate();
    
    // Select strictly from store (Read-Only)
    const store = useSessionStore();
    const toastIdRef = useRef<string | number | null>(null);

    // 1. Core Service Hooks (Projections)
    const stt = useTranscriptionState(); // Already refactored to read from store
    const { 
        isRecording: storeIsListening, 
        interimTranscript: storeInterim,
        finalChunks,
        state: runtimeState
    } = stt;

    // Mapping for backward compatibility within this hook
    const storeTranscript = { partial: storeInterim };

    // Additional store access for specialized fields not in stt hook
    const { 
        isReady: storeIsReady, 
        sttStatus, 
        modelLoadingProgress, 
        elapsedTime,
    } = store;
    useTranscriptionControl();
    const filler = useFillerWords(finalChunks as unknown as Chunk[], storeTranscript.partial, userWords);
    const vocal = useVocalAnalysis();
    // timer logic is centralized in useSessionStore.tick (driven by useSessionLifecycle)

    // 2. Specialized Callbacks (Controller Auth)
    const getAssemblyAIToken = useCallback(async (): Promise<string | null> => {
        const rateCheck = checkRateLimit('ASSEMBLYAI_TOKEN');
        if (!rateCheck.allowed && rateCheck.retryAfterMs && rateCheck.retryAfterMs > 0) {
            const seconds = Math.ceil(rateCheck.retryAfterMs / 1000);
            toast.error(`Please wait ${seconds} seconds before starting another session.`);
            return null;
        }

        try {
            const supabase = getSupabaseClient();
            const { data, error } = await supabase.functions.invoke(API_CONFIG.ASSEMBLYAI_TOKEN_ENDPOINT, { body: {} });
            if (error) throw new Error(`Token function error: ${error.message}`);
            return data.token;
        } catch (err: unknown) {
            logger.error({ err }, "Error getting AssemblyAI token");
            toast.error("Cloud STT Service Unavailable. Check connection or switch modes.");
            return null;
        }
    }, []);

    // 3. Callback Synchronization with Authoritative Controller
    useTranscriptionCallbacks({
        onTranscriptUpdate: () => {
            // Master Invariant: SpeechRuntimeController pushes to store directly.
            // This hook and the UI it serves will react via useSessionStore reactivity.
        },
        onAudioData: vocal.processAudioFrame,
        getAssemblyAIToken,
        session: session ?? null,
        navigate,
        userWords: userVocabulary,
        policy: buildPolicyForUser(profile?.subscription_status === 'pro', null),
        onReady: () => {
            logger.info('[useSpeechRecognition] Service ready signal received');
        },
        onStatusChange: (status: SttStatus) => {
            if (status.type === 'error') handleTranscriptionError(new Error(status.message));
            if (status.type === 'info') toast.info(status.message);
        },
        onError: handleTranscriptionError
    });

    // 4. Lifecycle Sync (Source of Truth for Vocal)
    useEffect(() => {
        vocal.setIsActive(storeIsListening);
    }, [storeIsListening, vocal]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            // Signal the controller that this specific subscriber is gone.
            // The controller decides whether to reset based on active session state.
            speechRuntimeController.reset('subscriber_unmount').catch(err => {
                logger.error({ err }, '[useSpeechRecognition] Cleanup reset failed');
            });
        };
    }, []);

    // 5. Public Actions (Controller Triggers)
    const reset = useCallback(() => {
        speechRuntimeController.reset('manual_reset').catch(err => {
            logger.error({ err }, '[useSpeechRecognition] Manual reset failed');
        });
        if (toastIdRef.current) {
            toast.dismiss(toastIdRef.current);
            toastIdRef.current = null;
        }
    }, []);

    const startListening = useCallback(async (policy: TranscriptionPolicy = E2E_DETERMINISTIC_NATIVE) => {
        await speechRuntimeController.startRecording(policy);
    }, []);

    const stopListening = useCallback(async (): Promise<(TranscriptStats & { filler_words: FillerCounts }) | null> => {
        if (toastIdRef.current) toast.dismiss(toastIdRef.current);

        const result = (await speechRuntimeController.stopRecording()) as TranscriptStats | null;

        if (result) {
            return {
                ...result,
                filler_words: filler.counts,
            };
        }
        return null;
    }, [filler]);

    // 6. Derived Props (Pure Projection)
    const transcriptStats = useMemo(() => {
        return calculateTranscriptStats(
            finalChunks as unknown as Array<{ transcript: string }>,
            [], // wordConfidences expected as WordConfidence[]
            storeTranscript.partial,
            elapsedTime
        );
    }, [finalChunks, storeTranscript.partial, elapsedTime]);

    return {
        transcript: transcriptStats,
        chunks: finalChunks,
        interimTranscript: storeTranscript.partial,
        fillerData: filler.counts,
        isListening: storeIsListening,
        isReady: storeIsReady,
        error: sttStatus.type === 'error' ? new Error(sttStatus.message) : null,
        isSupported: true,
        mode: runtimeState === 'RECORDING' ? 'active' : 'idle',
        sttStatus: sttStatus,
        modelLoadingProgress: modelLoadingProgress,
        startListening,
        stopListening,
        reset,
        pauseMetrics: vocal.pauseMetrics,
    };
};
