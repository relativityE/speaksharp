import { useState, useCallback, useRef, useEffect } from 'react';
import TranscriptionService from '../../services/transcription/TranscriptionService';
import type { TranscriptionServiceOptions } from '../../services/transcription/TranscriptionService';
import logger from '../../lib/logger';

interface ITranscriptionService {
  init: () => Promise<{ success: boolean }>;
  startTranscription: () => Promise<void>;
  stopTranscription: () => Promise<string>;
  destroy: () => Promise<void>;
  getMode: () => 'native' | 'cloud' | 'on-device' | null;
}

interface ForceOptions {
  forceCloud?: boolean;
  forceOnDevice?: boolean;
  forceNative?: boolean;
}

export const useTranscriptionService = (options: TranscriptionServiceOptions) => {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [currentMode, setCurrentMode] = useState<string | null>(null);

  const serviceRef = useRef<ITranscriptionService | null>(null);
  const initStateRef = useRef({ isInitializing: false });
  const isMountedRef = useRef<boolean>(true);

  const startListening = useCallback(async (forceOptions: ForceOptions = {}) => {
    if (isListening || initStateRef.current.isInitializing || !isMountedRef.current) return;

    initStateRef.current.isInitializing = true;
    setIsListening(true);
    setError(null);
    setIsReady(false);
    setIsSupported(true);

    try {
      // Cleanup existing service
      if (serviceRef.current) {
        await serviceRef.current.destroy();
        serviceRef.current = null;
      }

      // Create new service with force options
      const serviceOptions = { ...options, ...forceOptions };
      const service = new TranscriptionService(serviceOptions);
      serviceRef.current = service as unknown as ITranscriptionService;

      await service.init();
      if (!isMountedRef.current) return;

      await service.startTranscription();
      if (isMountedRef.current) {
        setCurrentMode(service.getMode());
      }
    } catch (err) {
      if (isMountedRef.current) {
        handleTranscriptionError(err, setError, setIsSupported, setIsListening);
      }
    } finally {
      initStateRef.current.isInitializing = false;
    }
  }, [isListening, options]);

  const stopListening = useCallback(async () => {
    if (!isListening || !serviceRef.current || !isMountedRef.current) return null;

    // Wait for initialization to complete
    while (initStateRef.current.isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    try {
      await serviceRef.current.stopTranscription();
      if (isMountedRef.current) {
        setIsListening(false);
        setIsReady(false);
        return { success: true };
      }
    } catch (err) {
      if (isMountedRef.current) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
      }
    }
    return null;
  }, [isListening]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (serviceRef.current) {
        serviceRef.current.destroy().catch(err => {
          logger.error({ err }, 'Error destroying service on unmount');
        });
      }
    };
  }, []);

  return {
    isListening,
    isReady,
    error,
    isSupported,
    mode: currentMode,
    startListening,
    stopListening,
    setIsReady
  };
};

// Error handling extracted from original hook
function handleTranscriptionError(
  err: unknown,
  setError: (error: Error) => void,
  setIsSupported: (supported: boolean) => void,
  setIsListening: (listening: boolean) => void
) {
  let friendlyError: Error;
  const originalError = err instanceof Error ? err : new Error(String(err));
  const message = originalError.message.toLowerCase();

  if (message.includes('permission denied')) {
    friendlyError = new Error('Microphone permission denied. Please enable microphone access in your browser settings.');
    setIsSupported(false);
  } else if (message.includes('assemblyai token')) {
    friendlyError = new Error('Could not connect to the cloud transcription service. Please check your internet connection and try again.');
  } else if (message.includes('failed to load model')) {
    friendlyError = new Error('Failed to load the on-device model. Please check your internet connection or try a different transcription mode.');
  } else if (message.includes('not initialized')) {
    friendlyError = new Error('The transcription service could not be started. Please try refreshing the page.');
  } else {
    friendlyError = new Error('An unexpected error occurred. Please try again.');
  }

  logger.error({ err: originalError }, 'An error occurred during speech recognition setup');
  setError(friendlyError);
  setIsListening(false);
}