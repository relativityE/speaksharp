import { useMemo, useCallback, useState, useRef } from 'react';
import { useAuthProvider } from '../../contexts/AuthProvider';
import { useNavigate } from 'react-router-dom';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { calculateTranscriptStats } from '../../utils/fillerWordUtils';
import logger from '../../lib/logger';
import { toast } from 'sonner';
import { checkRateLimit } from '../../lib/rateLimiter';

import { useTranscriptState } from './useTranscriptState';
import { useFillerWords } from './useFillerWords';
import { useTranscriptionService } from './useTranscriptionService';
import { useSessionTimer } from './useSessionTimer';
import { useVocalAnalysis } from '../useVocalAnalysis';
import { API_CONFIG } from '../../config';
import type { UseSpeechRecognitionProps, TranscriptStats, TranscriptionPolicy } from './types';
import { E2E_DETERMINISTIC_NATIVE } from './types';
import type { FillerCounts } from '../../utils/fillerWordUtils';

export const useSpeechRecognition_prod = (props: UseSpeechRecognitionProps = {}) => {
  // Memoize defaults to ensure stable references and prevent infinite loops
  const customWords = useMemo(() => props.customWords || [], [props.customWords]);
  const customVocabulary = useMemo(() => props.customVocabulary || [], [props.customVocabulary]);
  const { session, profile } = props;
  const { session: authSession } = useAuthProvider();
  const navigate = useNavigate();

  const [modelLoadingProgress, setModelLoadingProgress] = useState<number | null>(null);
  const toastIdRef = useRef<string | number | null>(null);

  // Synced state for VocalAnalysis to avoid circular dependency with service creation
  const [internalIsListening, setInternalIsListening] = useState(false);

  const transcript = useTranscriptState();
  // Extract stable method references to avoid object identity issues in useMemo deps
  const { setInterimTranscript, addChunk } = transcript;
  const fillerWords = useFillerWords(transcript.finalChunks, transcript.interimTranscript, customWords);
  const vocalAnalysis = useVocalAnalysis(internalIsListening); // Pass dynamic state

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

      // SECURITY FIX: Removed anonymous sign-in logic that polluted auth.users table
      // Dev testing should use devBypass query parameter for mock sessions
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

      // Parse Supabase Edge Function "non-2xx" error for better clarity
      if (errorMessage.includes("non-2xx")) {
        errorMessage = "Cloud STT Service Unavailable. The backend service returned an error.";
        logger.error({ originalError: err }, "Edge Function 500/Non-2xx Error");
      }

      logger.error({ err }, "Error getting AssemblyAI token");

      // Show persistent toast for critical failure
      toast.error(errorMessage, {
        duration: 5000, // 5 seconds
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

        // INTELLIGENT CLEAR: If the final text is a prefix of the current interim,
        // subtract it instead of clearing completely to avoid UI flickering.
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
      // This callback is invoked by NativeBrowser and CloudAssemblyAI when they start successfully
      logger.info('[useSpeechRecognition] onReady callback invoked - transcription service is ready');
      // Dismiss loading toast if it exists
      if (toastIdRef.current) {
        toast.dismiss(toastIdRef.current);
        toastIdRef.current = null;
      }
      setModelLoadingProgress(null);
    },
    onModelLoadProgress: (progress: number | null) => {
      logger.info({ progress }, '[useSpeechRecognition] onModelLoadProgress called');

      if (progress === null) {
        if (toastIdRef.current) {
          toast.dismiss(toastIdRef.current);
          toastIdRef.current = null;
        }
        setModelLoadingProgress(null);
        return;
      }

      // Handle both fraction (0-1) and percentage (0-100+) inputs
      const percentage = progress > 1
        ? Math.min(Math.round(progress), 100)  // Already a percentage, clamp to 100
        : Math.round(progress * 100);           // Fraction, convert to percentage

      // Normalize state to percentage for UI consistency
      setModelLoadingProgress(percentage);

      // Show or update toast
      if (toastIdRef.current) {
        toast.loading(`Downloading AI model... ${percentage}%`, { id: toastIdRef.current });
      } else {
        toastIdRef.current = toast.loading(`Downloading AI model... ${percentage}%`);
      }

      // Dismiss toast when complete
      if (percentage >= 100) {
        setTimeout(() => {
          if (toastIdRef.current) {
            toast.dismiss(toastIdRef.current);
            // Removed "Model loaded successfully!" toast to avoid confusion during fallback
            // The Status Notification Bar will show "Ready" or "Recording active"
            toastIdRef.current = null;
          }
          setModelLoadingProgress(null);
        }, 500);
      }
    },
    profile: profile ?? null,
    session: session ?? null,
    navigate,
    getAssemblyAIToken,
    customVocabulary,
    // PLUMBING: Pass audio frame analyzer for pause detection
    onAudioData: vocalAnalysis.processAudioFrame,
  }), [profile, session, navigate, getAssemblyAIToken, customVocabulary, setInterimTranscript, addChunk, vocalAnalysis.processAudioFrame]);

  const service = useTranscriptionService(serviceOptions);

  // Sync service state to internal state for VocalAnalysis
  // This avoids the circular dependency where hook creation needs service state
  if (service.isListening !== internalIsListening) {
    setInternalIsListening(service.isListening);
  }
  const sessionTimer = useSessionTimer(service.isListening);

  const reset = useCallback(() => {
    transcript.reset();
    fillerWords.reset();
    sessionTimer.reset();
    service.reset();
    // Also reset model loading state
    setModelLoadingProgress(null);
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
    // P1 BUG FIX: Reset model loading state when stopping to prevent "Initializing..." from persisting
    setModelLoadingProgress(null);
    if (toastIdRef.current) {
      toast.dismiss(toastIdRef.current);
      toastIdRef.current = null;
    }

    const result = await service.stopListening();
    if (result && result.success) {
      const stats = calculateTranscriptStats(
        transcript.finalChunks,
        [],
        transcript.interimTranscript,
        sessionTimer.duration
      );
      return {
        ...stats,
        total_words: stats.total_words,
        filler_words: fillerWords.finalFillerData,
        accuracy: stats.accuracy,
        transcript: stats.transcript,
      };
    }
    return null;
  }, [service, transcript, fillerWords, sessionTimer.duration]);

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
    modelLoadingProgress,
    startListening,
    stopListening,
    reset,
    pauseMetrics: vocalAnalysis.pauseMetrics,
  };
};

export const useSpeechRecognition = useSpeechRecognition_prod;

export default useSpeechRecognition;
