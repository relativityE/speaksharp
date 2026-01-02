import { useState, useCallback, useRef, useEffect } from 'react';
import TranscriptionService from '../../services/transcription/TranscriptionService';
import type { TranscriptionServiceOptions } from '../../services/transcription/TranscriptionService';
import logger from '../../lib/logger';

interface ITranscriptionService {
  init: () => Promise<{ success: boolean }>;
  startTranscription: () => Promise<void>;
  stopTranscription: () => Promise<string>;
  destroy: () => Promise<void>;
  getMode: () => 'native' | 'cloud' | 'private' | null;
}

interface ForceOptions {
  forceCloud?: boolean;
  forcePrivate?: boolean;
  forceNative?: boolean;
}

export const useTranscriptionService = (options: TranscriptionServiceOptions) => {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [currentMode, setCurrentMode] = useState<string | null>(null);

  const serviceRef = useRef<ITranscriptionService | null>(null);
  const forceOptionsRef = useRef<ForceOptions>({});
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    let isCancelled = false;

    const manageService = async () => {
      if (isListening) {
        // If listening starts, create and initialize a new service.
        setError(null);
        setIsReady(false);
        setIsSupported(true);

        // Wrap the onReady callback to set our internal isReady state
        const wrappedOptions = {
          ...optionsRef.current,
          onReady: () => {
            setIsReady(true);
            // Also call the user-provided onReady callback
            optionsRef.current.onReady();
          },
          onModeChange: setCurrentMode,
        };

        console.log('[useTranscriptionService] Creating new service with forceOptions:', forceOptionsRef.current);
        const service = new TranscriptionService({
          ...wrappedOptions,
          ...forceOptionsRef.current,
        });
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
  }, [isListening]);

  const startListening = useCallback(async (forceOptions: ForceOptions = {}) => {
    if (isListening) return;
    forceOptionsRef.current = forceOptions;
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
  }, []);

  return {
    isListening,
    isReady,
    error,
    isSupported,
    mode: currentMode,
    startListening,
    stopListening,
    reset,
    setIsReady,
  };
};

import { toast } from 'sonner';

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
