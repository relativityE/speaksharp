import { useCallback, useRef, useEffect, useMemo } from 'react';
import { TranscriptionServiceOptions } from '../../services/transcription/TranscriptionService';
import {
  TranscriptionPolicy,
  TranscriptionMode,
} from '../../services/transcription/TranscriptionPolicy';
import { toast } from '@/lib/toast';
import logger from '../../lib/logger';
import { speechRuntimeController } from '../../services/SpeechRuntimeController';
import { TranscriptStats } from '../../utils/fillerWordUtils';
import { TranscriptUpdate } from '../../types/transcription';
import { useTranscriptionContext } from '@/providers/useTranscriptionContext';
import { useTranscriptionState } from './useTranscriptionState';

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
  isServiceDestroyed: () => boolean;
}

export interface UseTranscriptionServiceOptions {
  onTranscriptUpdate: TranscriptionServiceOptions['onTranscriptUpdate'];
  onModelLoadProgress?: TranscriptionServiceOptions['onModelLoadProgress'];
  onReady?: TranscriptionServiceOptions['onReady'];
  session: TranscriptionServiceOptions['session'];
  navigate: TranscriptionServiceOptions['navigate'];
  getAssemblyAIToken: TranscriptionServiceOptions['getAssemblyAIToken'];
  userWords?: string[];
  onAudioData?: TranscriptionServiceOptions['onAudioData'];
  policy?: TranscriptionPolicy;
  profileLoading?: boolean;
}

export const useTranscriptionService = (options: UseTranscriptionServiceOptions) => {
  // ============================================
  // CONTEXT & STORE (Pure Listeners)
  // ============================================
  const { isReady: isContextReady, useStore } = useTranscriptionContext();
  const {
    isListening,
    isReady,
    sttStatus,
    sttMode: currentMode,
    modelLoadingProgress,
    startSession // Only for UI intent, FSM handles transition
  } = useStore();

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

  // 1. State Management (Reactive Updates from Store)
  const { error } = useTranscriptionState();

  // 2. Callback Management (Stable References for Controller)
  const callbacks: Partial<TranscriptionServiceOptions> = useMemo(() => ({
    onTranscriptUpdate: (update: TranscriptUpdate) => {
      console.warn('[TRACE] CALLBACK_DATA', !!update.transcript.final);
      optionsRef.current.onTranscriptUpdate(update);
    },
    onModelLoadProgress: (progress: number | null) => optionsRef.current.onModelLoadProgress?.(progress),
    onReady: () => {
      console.warn('[TRACE] CALLBACK_READY');
      // Logic removed: FSM handles setReady(true) via controller.confirmSubscriberHandshake() or transition
      optionsRef.current.onReady?.();
    },
    onAudioData: (data: Float32Array) => optionsRef.current.onAudioData?.(data),
    getAssemblyAIToken: () => optionsRef.current.getAssemblyAIToken(),
    session: options.session,
    navigate: options.navigate,
    userWords: options.userWords,
  }), [options.session, options.navigate, options.userWords]);

  // ============================================
  // SYNC WITH SINGLETON (Callbacks & Policy)
  // ============================================
  useEffect(() => {
    isMountedRef.current = true;
    
    // Register callbacks with the authoritative controller
    speechRuntimeController.setSubscriberCallbacks(callbacks);

    return () => {
      isMountedRef.current = false;
      // 🛡️ Layer 1: Cleanup Symmetry (v0.6.4)
      // Explicitly signal the unsubscription to the class-based controller.
      void speechRuntimeController.reset('subscriber_unmount');
    };
  }, [callbacks]);

  useEffect(() => {
    if (!isContextReady) return;
    if (optionsRef.current.policy) {
      speechRuntimeController.updatePolicy(optionsRef.current.policy);
    }
  }, [isContextReady, options.policy]);

  // ============================================
  // ERROR HANDLING (Side Effects from Service/FSM via Store)
  // ============================================
  useEffect(() => {
    if (sttStatus.type === 'error') {
      handleTranscriptionError(sttStatus.message, options.navigate);
    }
  }, [sttStatus, options.navigate]);

  // ============================================
  // LIFECYCLE MANAGEMENT (Start/Init)
  // ============================================
  useEffect(() => {
    // 🏎️ RACE CONDITION FIX: Managed by Controller's internal queue
    if (!isContextReady || !isListening || isStartingRef.current) return;

    // GUARD: Profile loading
    if (optionsRef.current.profileLoading) return;

    const manageSession = async () => {
      isStartingRef.current = true;
      try {
        await speechRuntimeController.startRecording();
      } catch (err) {
        // Errors handled via sttStatus listener above
      } finally {
        isStartingRef.current = false;
      }
    };

    void manageSession();
  }, [isContextReady, isListening, options.profileLoading]);

  // ============================================
  // ACTIONS (Pure Controller Triggers)
  // ============================================
  const startListening = useCallback(async (policy: TranscriptionPolicy) => {
    if (isListening) return;
    logger.info('[Hook] startListening triggered via intent');
    manualPolicyRef.current = policy;
    startSession(); // Set initial listening intent, FSM will confirm
  }, [isListening, startSession]);

  const stopListening = useCallback(async () => {
    if (!isListening) return null;
    logger.info('[Hook] stopListening triggered via intent');
    return await speechRuntimeController.stopRecording();
  }, [isListening]);

  const reset = useCallback(() => {
    void speechRuntimeController.reset('manual_reset');
  }, []);

  return {
    isListening,
    isReady,
    error,
    isSupported: true,
    mode: currentMode,
    sttStatus,
    modelLoadingProgress,
    startListening,
    stopListening,
    reset,
  };
};

// Error handling helper (Refined for STTStatus)
function handleTranscriptionError(
  message: string,
  _navigate: UseTranscriptionServiceOptions['navigate']
) {
  logger.error({ message }, 'An error occurred during speech recognition');
  toast.dismiss('stt-error-toast');
  toast.error(message, {
    id: 'stt-error-toast',
    duration: 5000
  });
}
