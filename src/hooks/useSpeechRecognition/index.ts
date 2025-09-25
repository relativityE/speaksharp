import { useCallback } from 'react';
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

export const useSpeechRecognition = (props: UseSpeechRecognitionProps = {}) => {
  const { customWords = [], session, profile } = props;
  const { session: authSession } = useAuth();
  const navigate = useNavigate();

  // Sub-hooks with single responsibilities
  const transcript = useTranscriptState();
  const fillerWords = useFillerWords(transcript.finalChunks, transcript.interimTranscript, customWords);

  // Token logic extracted from original hook
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

  const service = useTranscriptionService({
    onTranscriptUpdate: (data: { transcript: { partial?: string; final?: string } }) => {
      if (data.transcript?.partial && !data.transcript.partial.startsWith('Downloading model')) {
        transcript.setInterimTranscript(data.transcript.partial);
      }
      if (data.transcript?.final) {
        transcript.addChunk(data.transcript.final);
        transcript.setInterimTranscript('');
      }
    },
    onReady: () => {},
    onModelLoadProgress: () => {},
    profile: profile ?? null,
    session: session ?? null,
    navigate,
    getAssemblyAIToken,
  });


  // Composed reset function
  const reset = useCallback(() => {
    transcript.reset();
    fillerWords.reset();
  }, [transcript, fillerWords]);

  // Enhanced stopListening that returns stats
  const stopListening = useCallback(async (): Promise<(TranscriptStats & { filler_words: FillerCounts }) | null> => {
    const result = await service.stopListening();
    if (result && result.success) {
      const stats = calculateTranscriptStats(
        transcript.finalChunks,
        [], // word confidences - add if needed
        transcript.interimTranscript
      );
      return { ...stats, filler_words: fillerWords.finalFillerData };
    }
    return null;
  }, [service, transcript, fillerWords]);

  return {
    // Transcript state
    transcript: transcript.transcript,
    chunks: transcript.finalChunks,
    interimTranscript: transcript.interimTranscript,

    // Filler word data
    fillerData: fillerWords.fillerData,

    // Service state
    isListening: service.isListening,
    isReady: service.isReady,
    error: service.error,
    isSupported: service.isSupported,
    mode: service.mode,
    modelLoadingProgress: null, // Add back if needed

    // Actions
    startListening: service.startListening,
    stopListening,
    reset
  };
};

// Re-export for backward compatibility
export default useSpeechRecognition;