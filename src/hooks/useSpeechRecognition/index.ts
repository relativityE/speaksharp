import { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { useAuth } from '../../contexts/useAuth';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { calculateTranscriptStats } from '../../utils/fillerWordUtils';
import logger from '../../lib/logger';
import { toast } from 'sonner';

import { useTranscriptState } from './useTranscriptState';
import { useFillerWords } from './useFillerWords';
import { useTranscriptionService } from './useTranscriptionService';
import type { UseSpeechRecognitionProps, TranscriptStats } from './types';
import type { FillerCounts } from '../../utils/fillerWordUtils';
import { ForceOptions } from './types';

export const useSpeechRecognition = (props: UseSpeechRecognitionProps = {}) => {
  // ============================================================================
  // CRITICAL FIX: Check for E2E mock BEFORE any other code runs
  // ============================================================================
  if (typeof window !== 'undefined' && window.__MOCK_SPEECH_RECOGNITION__) {
    console.log('[useSpeechRecognition] Using E2E mock implementation');
    return window.__MOCK_SPEECH_RECOGNITION__ as any;
  }
  // ============================================================================

  const { customWords = [], session, profile } = props;
  const { session: authSession } = useAuth();
  const navigate = useNavigate();

  const [duration, setDuration] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const transcript = useTranscriptState();
  const fillerWords = useFillerWords(transcript.finalChunks, transcript.interimTranscript, customWords);

  const getAssemblyAIToken = useCallback(async (): Promise<string | null> => {
    try {
      let userSession = authSession;
      if (import.meta.env.VITE_DEV_MODE === 'true' && !userSession) {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) throw new Error(`Anonymous sign-in failed: ${error.message}`);
        if (!data.session) throw new Error('Anonymous sign-in did not return a session.');
        userSession = data.session;
      }
      const { data, error } = await supabase.functions.invoke('assemblyai-token', { body: {} });
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
      if (data.transcript?.partial && !data.transcript.partial.startsWith('Downloading model')) {
        transcript.setInterimTranscript(data.transcript.partial);
      }
      if (data.transcript?.final) {
        transcript.addChunk(data.transcript.final, data.speaker);
        transcript.setInterimTranscript('');
      }
    },
    onReady: () => {},
    onModelLoadProgress: () => {},
    profile: profile ?? null,
    session: session ?? null,
    navigate,
    getAssemblyAIToken,
  }), [transcript, profile, session, navigate, getAssemblyAIToken]);

  const service = useTranscriptionService(serviceOptions);

  useEffect(() => {
    if (service.isListening) {
      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [service.isListening]);

  const reset = useCallback(() => {
    transcript.reset();
    fillerWords.reset();
    setDuration(0);
    service.reset();
  }, [transcript, fillerWords, service]);

  const startListening = useCallback(async (forceOptions: ForceOptions = {}) => {
    reset();
    await service.startListening(forceOptions);
  }, [service, reset]);

  const stopListening = useCallback(async (): Promise<(TranscriptStats & { filler_words: FillerCounts }) | null> => {
    const result = await service.stopListening();
    if (result && result.success) {
      const stats = calculateTranscriptStats(
        transcript.finalChunks,
        [],
        transcript.interimTranscript,
        duration
      );
      return { ...stats, filler_words: fillerWords.finalFillerData };
    }
    return null;
  }, [service, transcript, fillerWords, duration]);

  const transcriptStats = useMemo(() => {
    return calculateTranscriptStats(
      transcript.finalChunks,
      [],
      transcript.interimTranscript,
      duration
    );
  }, [transcript.finalChunks, transcript.interimTranscript, duration]);

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
    modelLoadingProgress: null,
    startListening,
    stopListening,
    reset
  };
};

// Re-export for backward compatibility
export default useSpeechRecognition;
