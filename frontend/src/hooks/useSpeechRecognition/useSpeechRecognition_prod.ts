import { useMemo, useCallback, useRef, useEffect } from 'react';
import { useAuthProvider } from '../../contexts/AuthProvider';
import { useNavigate } from 'react-router-dom';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { calculateTranscriptStats } from '../../utils/fillerWordUtils';
import logger from '../../lib/logger';
import { useProfile } from '../useProfile';
import { toast } from '@/lib/toast';
import { checkRateLimit } from '../../lib/rateLimiter';

import { useTranscriptState } from './useTranscriptState';
import { useFillerWords } from './useFillerWords';
import { useTranscriptionService } from './useTranscriptionService';
import { useSessionTimer } from './useSessionTimer';
import { useVocalAnalysis } from '../useVocalAnalysis';
import { API_CONFIG } from '../../config';
import type { UseSpeechRecognitionProps, TranscriptStats, TranscriptionPolicy } from './types';
import { E2E_DETERMINISTIC_NATIVE, buildPolicyForUser } from './types';
import type { FillerCounts } from '../../utils/fillerWordUtils';

export const useSpeechRecognition_prod = (props: UseSpeechRecognitionProps = {}) => {
    // Memoize defaults to ensure stable references and prevent infinite loops
    const customWords = useMemo(() => props.customWords || [], [props.customWords]);
    const customVocabulary = useMemo(() => props.customVocabulary || [], [props.customVocabulary]);
    const { session } = props;
    const profile = useProfile();
    const { session: authSession } = useAuthProvider();
    const navigate = useNavigate();

    const toastIdRef = useRef<string | number | null>(null);

    const transcript = useTranscriptState();
    // Extract stable method references to avoid object identity issues in useMemo deps
    const { setInterimTranscript, addChunk } = transcript;
    const fillerWords = useFillerWords(transcript.finalChunks, transcript.interimTranscript, customWords);

    // [Fix: Circular Dependency] Initialize independent of service state
    const vocalAnalysis = useVocalAnalysis();

    const getAssemblyAIToken = useCallback(async (): Promise<string | null> => {
        // Rate limit check to prevent abuse
        const rateCheck = checkRateLimit('ASSEMBLYAI_TOKEN');
        if (!rateCheck.allowed && rateCheck.retryAfterMs && rateCheck.retryAfterMs > 0) {
            const seconds = Math.ceil(rateCheck.retryAfterMs / 1000);
            toast.error(`Please wait ${seconds} seconds before starting another session.`);
            logger.warn({ retryAfterMs: rateCheck.retryAfterMs }, 'Rate limited token request');
            return null;
        }

        try {
            const supabase = getSupabaseClient();
            if (!supabase) throw new Error("Supabase client not available");

            if (!authSession) {
                logger.warn('[getAssemblyAIToken] No auth session available - cannot fetch token');
                toast.error('Please sign in to use transcription features');
                return null;
            }

            const { data, error } = await supabase.functions.invoke(API_CONFIG.ASSEMBLYAI_TOKEN_ENDPOINT, { body: {} });
            if (error) throw new Error(`Failed to invoke token function: ${error.message}`);
            if (!data || !data.token) throw new Error("No valid AssemblyAI token returned.");
            return data.token;
        } catch (err: unknown) {
            let errorMessage = err instanceof Error ? err.message : String(err);
            if (errorMessage.includes("non-2xx")) {
                errorMessage = "Cloud STT Service Unavailable. The backend service returned an error.";
                logger.error({ originalError: err }, "Edge Function 500/Non-2xx Error");
            }
            logger.error({ err }, "Error getting AssemblyAI token");
            toast.error(errorMessage, {
                duration: 5000,
                description: "Please switch to Native mode or try again later."
            });
            return null;
        }
    }, [authSession]);

    const serviceOptions = useMemo(() => ({
        onTranscriptUpdate: (data: { transcript: { partial?: string; final?: string }; speaker?: string }) => {
            if (data.transcript?.partial && !data.transcript.partial.startsWith('Downloading model')) {
                setInterimTranscript(data.transcript.partial);
            }
            if (data.transcript?.final) {
                addChunk(data.transcript.final, data.speaker);
                setInterimTranscript(prev => {
                    const trimmedFinal = data.transcript.final?.trim() || '';
                    const trimmedPrev = prev.trim();
                    if (trimmedPrev.startsWith(trimmedFinal)) {
                        const remainder = trimmedPrev.slice(trimmedFinal.length).trim();
                        return remainder;
                    }
                    return '';
                });
            }
        },
        onReady: () => {
            logger.info('[useSpeechRecognition] onReady callback invoked');
            // CRITICAL: Internal service ready does NOT mean background downloads are done.
            // We NO LONGER clear modelLoadingProgress here because of "Optimistic Entry".
            // If we fall back to Native while Private downloads in background, Native calls 
            // onReady immediately. Clearing progress here would hide the background task.
        },
        profile: profile,
        session: session ?? null,
        navigate,
        getAssemblyAIToken,
        customVocabulary,
        onAudioData: vocalAnalysis.processAudioFrame,
        profileLoading: false, // Guaranteed by ProfileGuard
        policy: buildPolicyForUser(profile?.subscription_status === 'pro', null),
    }), [profile, session, navigate, getAssemblyAIToken, customVocabulary, vocalAnalysis.processAudioFrame, setInterimTranscript, addChunk]);

    // useSpeechRecognition.ts (Prod)
    const service = useTranscriptionService(serviceOptions);

    // [System Integrity] modelLoadingProgress is now consumed 
    // EXCLUSIVELY by the StatusNotificationBar via service.sttStatus.

    // Sync service state to internal state for VocalAnalysis
    // [Fix: Circular Dependency] Use effect instead of render-time sync
    useEffect(() => {
        vocalAnalysis.setIsActive(service.isListening);
    }, [service.isListening, vocalAnalysis.setIsActive, vocalAnalysis]);
    const sessionTimer = useSessionTimer(service.isListening);

    // [Fix: Stale Closure] Refs to capture latest state for async callbacks
    const latestTranscriptRef = useRef(transcript);
    const latestFillerWordsRef = useRef(fillerWords);
    const latestSessionTimerRef = useRef(sessionTimer);

    useEffect(() => {
        latestTranscriptRef.current = transcript;
        latestFillerWordsRef.current = fillerWords;
        latestSessionTimerRef.current = sessionTimer;
    }, [transcript, fillerWords, sessionTimer]);

    const reset = useCallback(() => {
        transcript.reset();
        fillerWords.reset();
        sessionTimer.reset();
        service.reset();
        if (toastIdRef.current) {
            toast.dismiss(toastIdRef.current);
            toastIdRef.current = null;
        }
    }, [transcript, fillerWords, sessionTimer, service]);

    const startListening = useCallback(async (policy: TranscriptionPolicy = E2E_DETERMINISTIC_NATIVE) => {
        reset();
        await service.startListening(policy);
    }, [service, reset]);

    const stopListening = useCallback(async (): Promise<(TranscriptStats & { filler_words: FillerCounts }) | null> => {
        if (toastIdRef.current) {
            toast.dismiss(toastIdRef.current);
            toastIdRef.current = null;
        }

        const result = await service.stopListening();
        if (result && result.success) {
            // Use refs to get the VERY LATEST state after the async operation completes
            const finalTranscript = latestTranscriptRef.current;
            const finalTimer = latestSessionTimerRef.current;
            const finalFillers = latestFillerWordsRef.current;

            const stats = calculateTranscriptStats(
                finalTranscript.finalChunks,
                [],
                finalTranscript.interimTranscript,
                finalTimer.duration
            );
            return {
                ...stats,
                total_words: stats.total_words,
                filler_words: finalFillers.finalFillerData,
                accuracy: stats.accuracy,
                transcript: stats.transcript,
            };
        }
        return null;
    }, [service]);

    const transcriptStats = useMemo(() => {
        return calculateTranscriptStats(
            transcript.finalChunks,
            [],
            transcript.interimTranscript,
            sessionTimer.duration
        );
    }, [transcript.finalChunks, transcript.interimTranscript, sessionTimer.duration]);

    return {
        transcript: transcriptStats,
        chunks: transcript.finalChunks,
        interimTranscript: transcript.interimTranscript,
        fillerData: fillerWords.fillerData,
        isListening: service.isListening,
        isReady: service.isReady,
        error: service.error,
        isSupported: service.isSupported,
        mode: service.mode,
        sttStatus: service.sttStatus,
        modelLoadingProgress: service.modelLoadingProgress,
        startListening,
        stopListening,
        reset,
        pauseMetrics: vocalAnalysis.pauseMetrics,
    };
};
