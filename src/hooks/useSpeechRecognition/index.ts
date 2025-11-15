import { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { useAuthProvider } from '../../contexts/AuthProvider';
import { useNavigate } from 'react-router-dom';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { calculateTranscriptStats } from '../../utils/fillerWordUtils';
import logger from '../../lib/logger';
import { toast } from 'sonner';

import { useTranscriptState } from './useTranscriptState';
import { useFillerWords } from './useFillerWords';
import { useTranscriptionService } from './useTranscriptionService';
import type { UseSpeechRecognitionProps, TranscriptStats } from './types';
import type { FillerCounts } from '../../utils/fillerWordUtils';
import { ForceOptions } from './types';

export const useSpeechRecognition_prod = (props: UseSpeechRecognitionProps = {}) => {
  const { customWords = [], session, profile } = props;
  const { session: authSession } = useAuthProvider();
  const navigate = useNavigate();

  const [duration, setDuration] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const transcript = useTranscriptState();
  const fillerWords = useFillerWords(transcript.finalChunks, transcript.interimTranscript, customWords);

  const getAssemblyAIToken = useCallback(async (): Promise<string | null> => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase client not available");
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
      return {
        ...stats,
        total_words: stats.total_words,
        filler_words: fillerWords.finalFillerData,
        accuracy: stats.accuracy,
        transcript: stats.transcript,
      };
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

const useSpeechRecognition_test = () => {
  const [isListening, setIsListening] = useState(false);
  const mockTranscript = { wpm: 0, fillerWords: {}, wordCount: 0, transcript: isListening ? 'Recording in progress...' : '', duration: 0 };

  return {
    transcript: mockTranscript,
    chunks: [],
    interimTranscript: isListening ? 'Recording in progress...' : '',
    fillerData: { total: { count: 0, color: '' } },
    isListening: isListening,
    isReady: true, // Always ready in test mode.
    error: null,
    isSupported: true,
    mode: 'native',
    modelLoadingProgress: null,
    startListening: async () => { setIsListening(true); },
    stopListening: async () => {
      setIsListening(false);
      return { ...mockTranscript, filler_words: {} };
    },
    reset: () => { setIsListening(false); },
  };
};

export const useSpeechRecognition = import.meta.env.VITE_TEST_MODE
  ? useSpeechRecognition_test
  : useSpeechRecognition_prod;

export default useSpeechRecognition;
