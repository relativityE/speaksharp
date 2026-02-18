import { useMemo, useCallback, useRef, useEffect } from 'react';
import { useAuthProvider } from '../../contexts/AuthProvider';
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
import { useSessionTimer } from './useSessionTimer';
import { useVocalAnalysis } from '../useVocalAnalysis';
import { API_CONFIG } from '../../config';
import type { UseSpeechRecognitionProps, TranscriptStats, TranscriptionPolicy } from './types';
// import type { SttStatus } from '@/types/transcription'; // Unused
import { E2E_DETERMINISTIC_NATIVE, buildPolicyForUser } from './types';
import type { FillerCounts } from '../../utils/fillerWordUtils';
import { useSessionStore } from '../../stores/useSessionStore';

/**
 * Orchestrator Hook: useSpeechRecognition (Production)
 * Following "Strangler Fig" Pattern: Compose atomic hooks into a unified public API.
 * 
 * Responsibility: Coordinating lifecycle, state, and specialized services (VocalAnalysis, SessionTimer).
 */
export const useSpeechRecognition_prod = (props: UseSpeechRecognitionProps = {}) => {
    const customWords = useMemo(() => props.customWords || [], [props.customWords]);
    const customVocabulary = useMemo(() => props.customVocabulary || [], [props.customVocabulary]);
    const { session } = props;
    const profile = useProfile();
    const { session: authSession } = useAuthProvider();
    const navigate = useNavigate();
    const { stopSession, startSession, sttStatus, modelLoadingProgress } = useSessionStore();

    const toastIdRef = useRef<string | number | null>(null);

    // 1. Core Service Hooks
    const stt = useTranscriptionState();
    const control = useTranscriptionControl();
    const filler = useFillerWords(stt.finalChunks, stt.interimTranscript, customWords);
    const vocal = useVocalAnalysis();
    const timer = useSessionTimer(stt.isRecording);

    // 2. Specialized Callbacks
    const getAssemblyAIToken = useCallback(async (): Promise<string | null> => {
        const rateCheck = checkRateLimit('ASSEMBLYAI_TOKEN');
        if (!rateCheck.allowed && rateCheck.retryAfterMs && rateCheck.retryAfterMs > 0) {
            const seconds = Math.ceil(rateCheck.retryAfterMs / 1000);
            toast.error(`Please wait ${seconds} seconds before starting another session.`);
            return null;
        }

        try {
            const supabase = getSupabaseClient();
            if (!supabase || !authSession) throw new Error("Auth session missing");

            const { data, error } = await supabase.functions.invoke(API_CONFIG.ASSEMBLYAI_TOKEN_ENDPOINT, { body: {} });
            if (error) throw new Error(`Token function error: ${error.message}`);
            return data.token;
        } catch (err: unknown) {
            logger.error({ err }, "Error getting AssemblyAI token");
            toast.error("Cloud STT Service Unavailable. Check connection or switch modes.");
            return null;
        }
    }, [authSession]);

    // 3. Callback Synchronization
    useTranscriptionCallbacks({
        onTranscriptUpdate: (data) => {
            if (data.transcript?.partial && !data.transcript.partial.startsWith('Downloading model')) {
                stt.setInterimTranscript(data.transcript.partial);
            }
            if (data.transcript?.final) {
                stt.addChunk(data.transcript.final);
                stt.setInterimTranscript('');
            }
        },
        onAudioData: vocal.processAudioFrame,
        getAssemblyAIToken,
        session: session ?? null,
        navigate,
        customVocabulary,
        policy: buildPolicyForUser(profile?.subscription_status === 'pro', null),
        onReady: () => {
            logger.info('[useSpeechRecognition] Service ready');
            // console.log('[E2E_DEBUG] Fallback onReady called');

            const currentProgress = useSessionStore.getState().modelLoadingProgress;
            // console.log('[E2E_DEBUG] Current store state (progress):', currentProgress);

            // ✅ Update store to reflect recording has started
            // Use startSession() which sets isListening=true and startTime=Date.now()
            useSessionStore.getState().startSession();

            // ✅ If background download is active, preserve it
            const isBackgroundDownload = currentProgress !== null;

            if (isBackgroundDownload) {
                // Fallback mode: recording via Native while Private downloads
                useSessionStore.getState().setSTTStatus({
                    type: 'recording', // ✅ FIXED: Changed from 'ready' to 'recording'
                    message: 'Recording active'
                    // Note: modelLoadingProgress stays set (not cleared)
                });
                // console.log('[E2E_DEBUG] Fallback recording active, download continuing');
            } else {
                // Normal mode: recording via selected engine
                useSessionStore.getState().setSTTStatus({
                    type: 'recording', // ✅ FIXED: Changed from 'ready' to 'recording'
                    message: 'Recording active'
                });
                // console.log('[E2E_DEBUG] Normal recording active');
            }
        },
        onError: (err) => stt.setError(err),
        onModelLoadProgress: (progress) => {
            useSessionStore.getState().setModelLoadingProgress(progress);
        },
        onStatusChange: (status) => {
            if (status.type === 'error') handleTranscriptionError(new Error(status.message), stopSession);
        }
    });

    // 4. Lifecycle Sync (Source of Truth for Vocal)
    useEffect(() => {
        vocal.setIsActive(stt.isRecording);
    }, [stt.isRecording, vocal]);

    // 5. Public Actions
    const reset = useCallback(() => {
        stt.reset();
        timer.reset();
        stopSession();
        if (toastIdRef.current) {
            toast.dismiss(toastIdRef.current);
            toastIdRef.current = null;
        }
    }, [stt, filler, timer, stopSession]);

    const startListening = useCallback(async (policy: TranscriptionPolicy = E2E_DETERMINISTIC_NATIVE) => {
        reset();
        startSession(); // UI Intent
        await control.startListening(policy);
    }, [control, reset, startSession]);

    const stopListening = useCallback(async (): Promise<(TranscriptStats & { filler_words: FillerCounts }) | null> => {
        if (toastIdRef.current) toast.dismiss(toastIdRef.current);

        const result = await control.stopListening();
        stopSession();

        if (result && result.success) {
            const stats = calculateTranscriptStats(
                stt.finalChunks,
                [],
                stt.interimTranscript,
                timer.duration
            );
            return {
                ...stats,
                filler_words: filler.counts,
            };
        }
        return null;
    }, [control, stt, timer, filler, stopSession]);

    // 6. Derived Props
    const transcriptStats = useMemo(() => {
        return calculateTranscriptStats(
            stt.finalChunks,
            [],
            stt.interimTranscript,
            timer.duration
        );
    }, [stt.finalChunks, stt.interimTranscript, timer.duration]);

    return {
        transcript: transcriptStats,
        chunks: stt.finalChunks,
        interimTranscript: stt.interimTranscript,
        fillerData: filler.counts,
        isListening: stt.isRecording || stt.isInitializing,
        isReady: control.isServiceReady,
        error: stt.error,
        isSupported: true,
        mode: stt.state === 'RECORDING' ? 'active' : 'idle', // Approximate legacy
        sttStatus: sttStatus, // ✅ FIXED: Return legitimate store state (recording/downloading/etc)
        modelLoadingProgress: modelLoadingProgress, // ✅ FIXED: Return legitimate download progress
        startListening,
        stopListening,
        reset,
        pauseMetrics: vocal.pauseMetrics,
    };
};

// Error handling helper
function handleTranscriptionError(err: Error, stopSession: () => void) {
    logger.error({ err }, 'Transcription Error');
    toast.error(err.message, { id: 'stt-error-toast', duration: 5000 });
    stopSession();
}
