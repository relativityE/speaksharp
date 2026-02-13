import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import TranscriptionService from '../../services/transcription/TranscriptionService';
import { testRegistry } from '../../services/transcription/TestRegistry';
import type { TranscriptionServiceOptions, SttStatus } from '../../services/transcription/TranscriptionService';
import {
  TranscriptionPolicy,
  TranscriptionMode,
  E2E_DETERMINISTIC_NATIVE,
} from '../../services/transcription/TranscriptionPolicy';
import { MicStream } from '../../services/transcription/utils/types';
import { toast } from '@/lib/toast';
import logger from '../../lib/logger';

interface ITranscriptionService {
  init: () => Promise<{ success: boolean }>;
  startTranscription: () => Promise<void>;
  stopTranscription: () => Promise<string>;
  destroy: () => Promise<void>;
  getMode: () => TranscriptionMode | null;
}

export interface UseTranscriptionServiceOptions {
  onTranscriptUpdate: TranscriptionServiceOptions['onTranscriptUpdate'];
  onModelLoadProgress: TranscriptionServiceOptions['onModelLoadProgress'];
  onReady: TranscriptionServiceOptions['onReady'];
  session: TranscriptionServiceOptions['session'];
  navigate: TranscriptionServiceOptions['navigate'];
  getAssemblyAIToken: TranscriptionServiceOptions['getAssemblyAIToken'];
  customVocabulary?: string[];
  onAudioData?: TranscriptionServiceOptions['onAudioData'];
}

export const useTranscriptionService = (options: UseTranscriptionServiceOptions) => {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [currentMode, setCurrentMode] = useState<TranscriptionMode | null>(null);
  const [sttStatus, setSttStatus] = useState<SttStatus>({ type: 'idle', message: 'Ready to record' });

  const serviceRef = useRef<ITranscriptionService | null>(null);
  const policyRef = useRef<TranscriptionPolicy>(E2E_DETERMINISTIC_NATIVE);
  const mockMicRef = useRef<MicStream | null>(null);
  const hasShownFallbackToastRef = useRef<boolean>(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // [Fix: Callback Wrapper Instability] 
  // Wrap callbacks in useMemo to ensure wrappedOptions has a stable reference forever.
  // This prevents the service from re-initializing or thinking callbacks have changed.
  const wrappedOptions = useMemo<TranscriptionServiceOptions>(() => ({
    // Spread current options (policy, session, etc. will be handled by refs if needed, 
    // but here we focus on the callbacks)
    ...optionsRef.current,

    onTranscriptUpdate: (...args) => optionsRef.current.onTranscriptUpdate(...args),
    onModelLoadProgress: (...args) => optionsRef.current.onModelLoadProgress(...args),
    getAssemblyAIToken: () => optionsRef.current.getAssemblyAIToken(),
    onAudioData: (...args) => optionsRef.current.onAudioData?.(...args),

    onReady: () => {
      setIsReady(true);
      // EXECUTIVE PATTERN: Success Confirmation
      toast.success("Private model ready", {
        description: "Now running locally",
        id: 'stt-milestone-toast',
        duration: 3000
      });
      optionsRef.current.onReady();
    },

    onModeChange: (mode: TranscriptionMode | null) => setCurrentMode(mode),
    onStatusChange: (status: SttStatus) => {
      setSttStatus(status);
      if (status.type === 'fallback' && status.newMode === 'native' && !hasShownFallbackToastRef.current) {
        hasShownFallbackToastRef.current = true;
        // EXECUTIVE PATTERN: Intent Acknowledgment
        toast.info("Setting up private model", {
          description: "Using Cloud model for now",
          id: 'stt-milestone-toast',
          duration: 3000
        });
      }
    },
    // Map refs that might change before init
    policy: policyRef.current,
    mockMic: mockMicRef.current ?? undefined,
  }), []); // Empty deps = stable forever

  useEffect(() => {
    let isCancelled = false;

    const manageService = async () => {
      if (isListening) {
        // If listening starts, create and initialize a new service.
        setError(null);
        setIsReady(false);
        setIsSupported(true);
        hasShownFallbackToastRef.current = false;

        logger.info({ intent: policyRef.current.executionIntent }, '[useTranscriptionService] Creating new service');

        // Update the stable object with the latest props before instantiating the service.
        // This ensures the service receives the most recent configuration (vocabulary, session, etc.)
        // while maintaining the stable reference of wrappedOptions.
        wrappedOptions.policy = policyRef.current;
        wrappedOptions.mockMic = mockMicRef.current ?? undefined;
        wrappedOptions.customVocabulary = optionsRef.current.customVocabulary;
        wrappedOptions.session = optionsRef.current.session;
        wrappedOptions.navigate = optionsRef.current.navigate;

        // DI / Test Registry Pattern for Constructor Injection
        let ServiceClass = TranscriptionService;
        if (import.meta.env.MODE === 'test' || import.meta.env.DEV) {
          const mockConstructor = testRegistry.get<typeof TranscriptionService>('TranscriptionService');
          if (mockConstructor) {
            ServiceClass = mockConstructor;
          }
        }

        const service = new ServiceClass(wrappedOptions);
        serviceRef.current = service as unknown as ITranscriptionService;

        try {
          await service.init();
          if (isCancelled) return;

          await service.startTranscription();
          if (isCancelled) return;

          setCurrentMode(service.getMode());
        } catch (err) {
          if (!isCancelled) {
            handleTranscriptionError(err, setError, setIsSupported, setIsListening);
          }
        }
      }
    };

    manageService();

    return () => {
      isCancelled = true;
      // Cleanup when isListening becomes false or on unmount.
      if (serviceRef.current) {
        serviceRef.current.destroy().catch(err => {
          logger.error({ err }, 'Error destroying transcription service');
        });
        serviceRef.current = null;
      }
    };
  }, [isListening, wrappedOptions]);

  /**
   * Start listening with the given policy.
   * 
   * @param policy - The TranscriptionPolicy to use for this session
   * @param mockMic - Optional mock microphone for E2E testing
   */
  const startListening = useCallback(async (
    policy: TranscriptionPolicy,
    mockMic?: MicStream
  ) => {
    if (isListening) return;
    policyRef.current = policy;
    mockMicRef.current = mockMic ?? null;
    setIsListening(true);
  }, [isListening]);

  const stopListening = useCallback(async () => {
    if (!isListening) return null;
    setIsListening(false);
    // The cleanup in the useEffect will handle the service destruction.
    return { success: true };
  }, [isListening]);

  const reset = useCallback(() => {
    setIsListening(false);
    setError(null);
    setSttStatus({ type: 'idle', message: 'Ready to record' });
  }, []);

  return {
    isListening,
    isReady,
    error,
    isSupported,
    mode: currentMode,
    sttStatus,
    startListening,
    stopListening,
    reset,
    setIsReady,
  };
};

// Error handling extracted from original hook
function handleTranscriptionError(
  err: unknown,
  setError: (error: Error) => void,
  setIsSupported: (supported: boolean) => void,
  setIsListening: (listening: boolean) => void
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
  toast.error(friendlyMessage, { duration: 10000 });
  setError(new Error(friendlyMessage));
  setIsListening(false);
}
