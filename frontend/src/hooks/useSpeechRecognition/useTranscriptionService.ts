import { useState, useCallback, useRef, useEffect } from 'react';
import TranscriptionService from '../../services/transcription/TranscriptionService';
import { TranscriptionServiceOptions } from '../../services/transcription/TranscriptionService';
import {
  TranscriptionPolicy,
  TranscriptionMode,
} from '../../services/transcription/TranscriptionPolicy';
import { toast } from '@/lib/toast';
import logger from '../../lib/logger';
import { TranscriptStats } from '../../utils/fillerWordUtils';
import { useSessionStore } from '../../stores/useSessionStore';

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
  // REFS (Survive re-renders & prevent death loops)
  // ============================================
  const serviceRef = useRef<TranscriptionService | null>(null);
  const isInitializingRef = useRef(false);
  const isMountedRef = useRef(true);
  const optionsRef = useRef(options);
  const manualPolicyRef = useRef<TranscriptionPolicy | null>(null);

  // Sync latest options from parent but preserve manual policy (intent) if it was set
  optionsRef.current = {
    ...options,
    policy: manualPolicyRef.current || options.policy
  };

  // ============================================
  // STORE (Single Source of Truth)
  // ============================================
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

  const [error, setError] = useState<Error | null>(null);
  const [isSupported, setIsSupported] = useState<boolean>(true);

  // ============================================
  // SERVICE INITIALIZATION (Runs ONCE per mount)
  // ============================================
  useEffect(() => {
    isMountedRef.current = true;

    // GUARD 1: Prevent double-init in React StrictMode
    if (isInitializingRef.current) {
      logger.info('[Hook] Already initializing, skipping');
      return;
    }

    // GUARD 2: Prevent recreation if service exists and is active
    if (serviceRef.current) {
      logger.info('[Hook] Service already exists, updating policy and callbacks');

      // CRITICAL: Hydrate singleton with fresh callbacks from this mount.
      // This fixes the stale closure issue after ProfileGuard remounts.
      serviceRef.current.updateCallbacks(optionsRef.current);

      if (optionsRef.current.policy) {
        serviceRef.current.updatePolicy(optionsRef.current.policy);
      }
      serviceRef.current.startTranscription().catch(err => {
        handleTranscriptionError(err, setError, setIsSupported, stopSession);
      });
      return;
    }

    const initializeService = async () => {
      // Only init if we actually want to listen
      if (!isListening) return;

      // GUARD: Wait for profile if provided
      if (optionsRef.current.profileLoading) {
        logger.info('[Hook] Profile still loading, deferring initialization');
        return;
      }


      isInitializingRef.current = true;
      setError(null);
      setReady(false);

      try {
        const wrappedOptions: TranscriptionServiceOptions = {
          ...optionsRef.current,
          // Use proxies to avoid stale closures
          onTranscriptUpdate: (update) => optionsRef.current.onTranscriptUpdate(update),
          onModelLoadProgress: (progress) => optionsRef.current.onModelLoadProgress?.(progress),
          getAssemblyAIToken: () => optionsRef.current.getAssemblyAIToken(),
          onAudioData: (data) => optionsRef.current.onAudioData?.(data),
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
          policy: optionsRef.current.policy,
        };

        const service = new TranscriptionService(wrappedOptions);
        await service.init();

        if (!isMountedRef.current) {
          logger.info('[Hook] Unmounted during init, destroying');
          await service.destroy();
          return;
        }

        serviceRef.current = service;

        // Literal Expert Compliance: Start immediately upon successful init if isListening
        await service.startTranscription(optionsRef.current.policy);

        if (!isMountedRef.current) {
          logger.info('[Hook] Unmounted after start, destroying');
          await service.destroy();
          serviceRef.current = null;
          return;
        }

        setSTTMode(service.getMode());
        logger.info('[Hook] ✅ Service initialized successfully');

      } catch (err) {
        if (isMountedRef.current) {
          handleTranscriptionError(err, setError, setIsSupported, stopSession);
        }
      } finally {
        isInitializingRef.current = false;
      }
    };

    initializeService();

    // CLEANUP (Only on true unmount)
    return () => {
      isMountedRef.current = false;
    };
  }, [isListening, options.profileLoading, setReady, setSTTMode, setSTTStatus, stopSession]); // Added missing store dependencies

  // Final teardown on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (serviceRef.current && !isInitializingRef.current) {
        logger.info('[Hook] 🧹 Final Teardown: Destroying service');
        serviceRef.current.destroy().catch(err => {
          logger.error({ err }, 'Error destroying singleton service');
        });
        serviceRef.current = null;
      }
    };
  }, []);

  const startListening = useCallback(async (policy: TranscriptionPolicy) => {
    if (isListening) return;
    manualPolicyRef.current = policy;
    startSession();
  }, [isListening, startSession]);

  const stopListening = useCallback(async () => {
    if (!isListening || !serviceRef.current) return null;

    const result = await serviceRef.current.stopTranscription();
    stopSession();
    return result;
  }, [isListening, stopSession]);

  const reset = useCallback(() => {
    stopSession();
    setError(null);
    manualPolicyRef.current = null;
    setSTTStatus({ type: 'idle', message: 'Ready to record' });
  }, [stopSession, setSTTStatus]);

  return {
    isListening,
    isReady,
    error,
    isSupported,
    mode: currentMode,
    sttStatus,
    modelLoadingProgress,
    startListening,
    stopListening,
    reset,
    setReady,
    setIsSupported,
  };
};

// Error handling extracted from original hook
function handleTranscriptionError(
  err: unknown,
  setError: (error: Error) => void,
  setIsSupported: (supported: boolean) => void,
  stopSession: () => void
) {
  let friendlyMessage: string;
  const originalError = err instanceof Error ? err : new Error(String(err));
  const message = originalError.message.toLowerCase();

  if (message.includes('permission denied')) {
    friendlyMessage = 'Microphone permission denied. Please enable microphone access in your browser settings.';
    setIsSupported(false);
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
  setError(new Error(friendlyMessage));
  stopSession();
}
