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
import type { UseSpeechRecognitionProps, TranscriptStats } from './types';
import type { FillerCounts } from '../../utils/fillerWordUtils';
import { ForceOptions } from './types';

export const useSpeechRecognition_prod = (props: UseSpeechRecognitionProps = {}) => {
  const { customWords = [], customVocabulary = [], session, profile } = props;
  const { session: authSession } = useAuthProvider();
  const navigate = useNavigate();

  const [modelLoadingProgress, setModelLoadingProgress] = useState<number | null>(null);
  const toastIdRef = useRef<string | number | null>(null);

  const transcript = useTranscriptState();
  const fillerWords = useFillerWords(transcript.finalChunks, transcript.interimTranscript, customWords);
  const vocalAnalysis = useVocalAnalysis(false); // We'll enable this when we have mic access

  const getAssemblyAIToken = useCallback(async (): Promise<string | null> => {
    // Rate limit check to prevent abuse
    const rateCheck = checkRateLimit('ASSEMBLYAI_TOKEN');
    if (!rateCheck.allowed) {
      const seconds = Math.ceil((rateCheck.retryAfterMs || 0) / 1000);
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
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "Error getting AssemblyAI token");
      toast.error("Unable to start transcription: " + errorMessage);
      return null;
    }
  }, [authSession]);

  const serviceOptions = useMemo(() => ({
    onTranscriptUpdate: (data: { transcript: { partial?: string; final?: string }; speaker?: string }) => {
      logger.info({ data }, '[useSpeechRecognition] onTranscriptUpdate received data');
      if (data.transcript?.partial && !data.transcript.partial.startsWith('Downloading model')) {
        logger.info({ partial: data.transcript.partial }, '[useSpeechRecognition] Setting interim transcript');
        transcript.setInterimTranscript(data.transcript.partial);
      }
      if (data.transcript?.final) {
        logger.info({ final: data.transcript.final }, '[useSpeechRecognition] Adding final chunk');
        transcript.addChunk(data.transcript.final, data.speaker);
        transcript.setInterimTranscript('');
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

      setModelLoadingProgress(progress);

      // Handle both fraction (0-1) and percentage (0-100+) inputs
      // ... (rest of the logic)
      const percentage = progress > 1
        ? Math.min(Math.round(progress), 100)  // Already a percentage, clamp to 100
        : Math.round(progress * 100);           // Fraction, convert to percentage

      // Show or update toast
      if (toastIdRef.current) {
        toast.loading(`Downloading AI model... ${percentage}%`, { id: toastIdRef.current });
      } else {
        toastIdRef.current = toast.loading(`Downloading AI model... ${percentage}%`);
      }

      // Dismiss toast when complete (handle both 1.0 and 100)
      if (progress >= 1 && progress <= 1.1) {  // 1.0 for fraction, allow small overshoot
        setTimeout(() => {
          if (toastIdRef.current) {
            toast.dismiss(toastIdRef.current);
            toast.success('Model loaded successfully!', { id: 'model-loaded', duration: 10000 });
            toastIdRef.current = null;
          }
          setModelLoadingProgress(null);
        }, 500);
      } else if (progress >= 100) {  // 100 for percentage
        setTimeout(() => {
          if (toastIdRef.current) {
            toast.dismiss(toastIdRef.current);
            toast.success('Model loaded successfully!', { id: 'model-loaded', duration: 10000 });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- transcript methods are stable, but object reference changes frequently
  }), [profile, session, navigate, getAssemblyAIToken, customVocabulary]);

  const service = useTranscriptionService(serviceOptions);
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

  const startListening = useCallback(async (forceOptions: ForceOptions = {}) => {
    reset();
    await service.startListening(forceOptions);
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
    modelLoadingProgress,
    startListening,
    stopListening,
    reset,
    pauseMetrics: vocalAnalysis.pauseMetrics,
  };
};

export const useSpeechRecognition = useSpeechRecognition_prod;

export default useSpeechRecognition;
