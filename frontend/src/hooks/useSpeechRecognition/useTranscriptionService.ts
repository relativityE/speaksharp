import { useCallback, useRef, useEffect } from 'react';
import { TranscriptionServiceOptions } from '../../services/transcription/TranscriptionService';
import {
  TranscriptionPolicy,
  TranscriptionMode,
} from '../../services/transcription/TranscriptionPolicy';
import { toast } from '@/lib/toast';
import logger from '../../lib/logger';
import { TranscriptStats } from '../../utils/fillerWordUtils';
import { useSessionStore } from '../../stores/useSessionStore';
import { useTranscriptionContext } from '@/providers/useTranscriptionContext';
import { useTranscriptionState } from './useTranscriptionState';
import { useTranscriptionCallbacks } from './useTranscriptionCallbacks';

// Re-exporting to satisfy architectural contract and linting
export type { TranscriptStats };

/**
 * ARCHITECTURAL CONTRACT: ITranscriptionService
 * Following "System Integrity over Developer Velocity", we maintain explicit
 * service interfaces even when the linter suggests removal.
 */
export interface ITranscriptionService {
  init: () => Promise<{ success: boolean }>;
  startTranscription: () => Promise<void>;
  stopTranscription: () => Promise<{ success: boolean; transcript: string; stats: TranscriptStats } | null>;
  destroy: () => Promise<void>;
  getMode: () => TranscriptionMode | null;
}

export interface UseTranscriptionServiceOptions {
  onTranscriptUpdate: TranscriptionServiceOptions['onTranscriptUpdate'];
  onModelLoadProgress?: TranscriptionServiceOptions['onModelLoadProgress'];
  onReady?: TranscriptionServiceOptions['onReady'];
  session: TranscriptionServiceOptions['session'];
  navigate: TranscriptionServiceOptions['navigate'];
  getAssemblyAIToken: TranscriptionServiceOptions['getAssemblyAIToken'];
  customVocabulary?: string[];
  onAudioData?: TranscriptionServiceOptions['onAudioData'];
  policy?: TranscriptionPolicy;
  profileLoading?: boolean;
}

export const useTranscriptionService = (options: UseTranscriptionServiceOptions) => {
  // ============================================
  // CONTEXT & STORE
  // ============================================
  const { service, isReady: isServiceReady } = useTranscriptionContext();
  const {
    isListening,
    isReady,
    sttStatus,
    sttMode: currentMode,
    modelLoadingProgress,
    setReady,
    setSTTStatus,
    setSTTMode,
    startSession,
    stopSession
  } = useSessionStore();

  const isMountedRef = useRef(true);
  const isStartingRef = useRef(false);
  const optionsRef = useRef(options);
  const manualPolicyRef = useRef<TranscriptionPolicy | null>(null);

  // Sync latest options
  optionsRef.current = {
    ...options,
    policy: manualPolicyRef.current || options.policy
  };

  // ============================================
  // HOOK COMPOSITION
  // ============================================

  // 1. State Management (Reactive Updates)
  const { error, setError } = useTranscriptionState();

  // 2. Callback Management (Stable References)
  // We construct the callbacks object to pass to the helper hook
  const callbacks: Partial<TranscriptionServiceOptions> = {
    onTranscriptUpdate: (update) => optionsRef.current.onTranscriptUpdate(update),
    onModelLoadProgress: (progress) => optionsRef.current.onModelLoadProgress?.(progress),
    onReady: () => {
      if (isMountedRef.current) {
        setReady(true);
        optionsRef.current.onReady?.();
      }
    },
    onModeChange: (mode) => {
      if (isMountedRef.current) setSTTMode(mode);
    },
    onStatusChange: (status) => {
      if (isMountedRef.current) setSTTStatus(status);
    },
    onAudioData: (data) => optionsRef.current.onAudioData?.(data),
    onError: (err) => setError(err),
    getAssemblyAIToken: () => optionsRef.current.getAssemblyAIToken(),
    session: options.session,
    navigate: options.navigate,
    customVocabulary: options.customVocabulary,
  };

  useTranscriptionCallbacks(callbacks);

  // ============================================
  // SYNC WITH SINGLETON (Policy)
  // ============================================
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!service || !isServiceReady) return;
    if (optionsRef.current.policy) {
      service.updatePolicy(optionsRef.current.policy);
    }
  }, [service, isServiceReady, options.policy]);

  // ============================================
  // ERROR HANDLING (Side Effects from State)
  // ============================================
  useEffect(() => {
    if (error) {
      handleTranscriptionError(error, stopSession);
    }
  }, [error, stopSession]);

  // ============================================
  // LIFECYCLE MANAGEMENT (Start/Init)
  // ============================================
  useEffect(() => {
    // 🏎️ RACE CONDITION FIX: Prevent multiple simultaneous transcription starts (Fixes Domain 2)
    if (!service || !isServiceReady || !isListening || isStartingRef.current) return;

    // GUARD: Profile loading
    if (optionsRef.current.profileLoading) return;

    const manageSession = async () => {
      isStartingRef.current = true;
      try {
        await service.startTranscription(optionsRef.current.policy);

        if (isMountedRef.current) {
          setSTTMode(service.getMode());
        }
      } catch (err) {
        if (isMountedRef.current) {
          handleTranscriptionError(err, stopSession);
        }
      } finally {
        isStartingRef.current = false;
      }
    };

    manageSession();
  }, [service, isServiceReady, isListening, options.profileLoading, stopSession, setSTTMode]);

  // ============================================
  // ACTIONS
  // ============================================
  const startListening = useCallback(async (policy: TranscriptionPolicy) => {
    if (isListening) return;
    logger.info('[Hook] startListening called');
    manualPolicyRef.current = policy;
    startSession(); // Triggers effect above
  }, [isListening, startSession]);

  const stopListening = useCallback(async () => {
    if (!isListening || !service) return null;
    logger.info('[Hook] stopListening called');

    const result = await service.stopTranscription();
    stopSession();
    return result;
  }, [isListening, service, stopSession]);

  const reset = useCallback(() => {
    stopSession();
    manualPolicyRef.current = null;
    setSTTStatus({ type: 'idle', message: 'Ready to record' });
  }, [stopSession, setSTTStatus]);

  return {
    isListening,
    isReady,
    error,
    isSupported: true, // Legacy prop
    mode: currentMode,
    sttStatus,
    modelLoadingProgress,
    startListening,
    stopListening,
    reset,
    setReady,
    setIsSupported: () => { }, // Deprecated
  };
};

// Error handling helper
function handleTranscriptionError(
  err: unknown,
  stopSession: () => void
) {
  let friendlyMessage: string;
  const originalError = err instanceof Error ? err : new Error(String(err));
  const message = originalError.message.toLowerCase();

  if (message.includes('permission denied')) {
    friendlyMessage = 'Microphone permission denied. Please enable microphone access in your browser settings.';
  } else if (message.includes('assemblyai token')) {
    friendlyMessage = 'Could not connect to the cloud transcription service. Please check your internet connection and try again.';
  } else if (message.includes('failed to load model')) {
    friendlyMessage = 'Failed to load the Private model. Please check your internet connection or try a different transcription mode.';
  } else if (message.includes('device not found') || message.includes('notfounderror')) {
    friendlyMessage = 'No microphone input found. Please check your system settings or connection.';
  } else if (message.includes('not initialized')) {
    friendlyMessage = 'The transcription service could not be started. Please try refreshing the page.';
  } else {
    friendlyMessage = 'An unexpected error occurred. Please try again.';
  }

  logger.error({ err: originalError }, 'An error occurred during speech recognition setup');
  toast.dismiss('stt-error-toast');
  toast.error(friendlyMessage, {
    id: 'stt-error-toast',
    duration: 5000
  });
  stopSession();
}
