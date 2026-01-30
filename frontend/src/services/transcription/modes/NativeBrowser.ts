import logger from '../../../lib/logger';
import { ITranscriptionMode, TranscriptionModeOptions, Transcript, TranscriptionError } from './types';

// A simplified interface for the SpeechRecognition event
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: {
    isFinal: boolean;
    [key: number]: {
      transcript: string;
    };
  }[];
}

// A simplified interface for the SpeechRecognition error event
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

// Define a type for the SpeechRecognition API to avoid using 'any'
interface SpeechRecognition {
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionStatic {
  new(): SpeechRecognition;
}

export default class NativeBrowser implements ITranscriptionMode {
  private onTranscriptUpdate: (update: { transcript: Transcript }) => void;
  private onReady: () => void;
  private onError?: (error: TranscriptionError) => void;
  private recognition: SpeechRecognition | null;
  private isSupported: boolean;
  private transcript: string;
  private isListening: boolean;
  private isRestarting: boolean = false;

  constructor({ onTranscriptUpdate, onReady, onError }: TranscriptionModeOptions) {
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onReady = onReady;
    this.onError = onError;
    this.recognition = null;
    this.isSupported = true; // Assume supported, check in init
    this.transcript = '';
    this.isListening = false;
  }

  public async init(): Promise<void> {
    const SpeechRecognition = (window.SpeechRecognition || window.webkitSpeechRecognition) as SpeechRecognitionStatic;
    this.isSupported = !!SpeechRecognition;

    if (!this.isSupported) {
      throw new Error('Native browser speech recognition not supported');
    }
    this.recognition = new SpeechRecognition();
    this.recognition.interimResults = true;
    this.recognition.continuous = true;

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      try {
        logger.info({ resultIndex: event.resultIndex, resultsLength: event.results?.length }, '[NativeBrowser] onresult called!');
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
            logger.info({ finalTranscript }, '[NativeBrowser] Final transcript received');
          } else {
            interimTranscript += event.results[i][0].transcript;
            logger.info({ interimTranscript }, '[NativeBrowser] Interim transcript received');
          }
        }

        if (this.onTranscriptUpdate) {
          if (interimTranscript) {
            this.onTranscriptUpdate({ transcript: { partial: interimTranscript } });
          }
          if (finalTranscript) {
            this.transcript += finalTranscript;
            this.onTranscriptUpdate({ transcript: { final: finalTranscript } });
          }
        }
      } catch (error) {
        logger.error({ error }, "Error in NativeBrowser onresult handler:");
      }
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      try {
        logger.error({ error: event.error }, `[NativeBrowser] Speech recognition error: ${event.error}`);

        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          logger.error('[NativeBrowser] Microphone permission denied by user or browser settings');
          if (this.onError) {
            this.onError(TranscriptionError.permission('Microphone permission denied. Please allow microphone access in your browser/system settings.'));
          }
        }
      } catch (error) {
        logger.error({ error }, "Error in NativeBrowser onerror handler:");
      }
    };

    this.recognition.onend = () => {
      if (!this.isListening || this.isRestarting) return;

      try {
        logger.info('[NativeBrowser] onend reached, attempting immediate restart...');
        this.isRestarting = true;
        // INTENTIONAL DELAY: Hardware Release Buffer
        // The Web Speech API requires a brief tick to release the microphone handle
        // before a new .start() call will be accepted.
        setTimeout(() => {
          if (this.isListening && this.recognition) {
            try {
              this.recognition.start();
              this.isRestarting = false;
            } catch (err) {
              logger.error({ err }, "[NativeBrowser] Failed to restart in onend");
              this.isRestarting = false;
            }
          }
        }, 50);
      } catch (error) {
        logger.error({ error }, "Error in NativeBrowser onend handler:");
        this.isRestarting = false;
      }
    };
    logger.info('[NativeBrowser] Init complete.');

    // Notify that the service is ready immediately after initialization
    if (this.onReady) {
      logger.info('[NativeBrowser] Calling onReady callback...');
      this.onReady();
    }
  }

  public async startTranscription(): Promise<void> {
    logger.info('[NativeBrowser] startTranscription called');
    if (!this.recognition) {
      throw new Error('NativeBrowser not initialized');
    }
    if (this.isListening) {
      logger.warn('[NativeBrowser] Already listening, returning early');
      return;
    }
    this.transcript = '';
    this.isListening = true;
    logger.info('[NativeBrowser] Starting recognition.start()...');
    this.recognition.start();

    // E2E Test Bridge: Expose instance for mock dispatching
    // This ensures tests can control recognition even if initialization order varies
    interface E2EWindow extends Window {
      TEST_MODE?: boolean;
      dispatchMockTranscript?: unknown;
      __activeSpeechRecognition?: SpeechRecognition;
    }
    const win = window as unknown as E2EWindow;

    if (win.TEST_MODE || win.dispatchMockTranscript) {
      win.__activeSpeechRecognition = this.recognition;
      // Signal ready state for tests to avoid race conditions
      window.dispatchEvent(new CustomEvent('e2e:speech-recognition-ready'));
    }

    logger.info('[NativeBrowser] recognition.start() called successfully.');
  }

  public async stopTranscription(): Promise<string> {
    logger.info('[NativeBrowser] stopTranscription called');
    if (!this.recognition || !this.isListening) {
      logger.warn('[NativeBrowser] Not listening or recognition not initialized, returning current transcript.');
      return this.transcript;
    }
    this.isListening = false;
    this.recognition.stop();
    return this.transcript;
  }

  public async getTranscript(): Promise<string> {
    return this.transcript;
  }
}
